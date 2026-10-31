import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { linkSkills, withAdditionalDirectories } from "../../scripts/ops-setup.mjs";
import { temporaryFolder } from "../temporary-folder.ts";

/**
 * scripts/ops-setup.mjs, which connects a checkout to the private ops repo: one link per skill in the main
 * checkout's .claude/skills/ (npm run ship and the session-start hook keep them in step), and the ops folders in
 * .claude/settings.local.json. Nothing here needs ops to exist.
 */

let workDir = "";
beforeEach(() => { workDir = temporaryFolder("ops-setup-"); });
afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });

/** An ops clone with skills a and b, and a checkout with the given entries in .claude/skills/. */
function opsAndCheckout() {
  const opsDir = join(workDir, "ops");
  const checkoutDir = join(workDir, "checkout");
  for (const name of ["a", "b"]) {
    mkdirSync(join(opsDir, ".claude", "skills", name), { recursive: true });
    writeFileSync(join(opsDir, ".claude", "skills", name, "SKILL.md"), `---\nname: ${name}\n---\n`);
  }
  mkdirSync(join(checkoutDir, ".claude"), { recursive: true });
  return { opsDir, checkoutDir, skillsDir: join(checkoutDir, ".claude", "skills") };
}

describe("linking ops' skills", () => {
  it("links each skill where nothing is, and a second run changes nothing", () => {
    const { opsDir, checkoutDir, skillsDir } = opsAndCheckout();
    expect(linkSkills({ checkoutDir, opsDir })).toEqual({ linked: ["a", "b"], kept_folders: [], removed: [] });
    expect(readlinkSync(join(skillsDir, "a"))).toBe(join(opsDir, ".claude", "skills", "a"));
    expect(linkSkills({ checkoutDir, opsDir })).toEqual({ linked: [], kept_folders: [], removed: [] });
  });

  it("leaves a real folder alone, the tracked copy before the pull that removes it", () => {
    const { opsDir, checkoutDir, skillsDir } = opsAndCheckout();
    mkdirSync(join(skillsDir, "a"), { recursive: true });
    writeFileSync(join(skillsDir, "a", "SKILL.md"), "tracked\n");
    expect(linkSkills({ checkoutDir, opsDir })).toEqual({ linked: ["b"], kept_folders: ["a"], removed: [] });
    expect(lstatSync(join(skillsDir, "a")).isSymbolicLink()).toBe(false);
  });

  it("points a stale link again and removes the link of a skill ops dropped, never anyone else's", () => {
    const { opsDir, checkoutDir, skillsDir } = opsAndCheckout();
    mkdirSync(skillsDir, { recursive: true });
    symlinkSync(join(workDir, "elsewhere"), join(skillsDir, "a"), "dir");
    symlinkSync(join(opsDir, ".claude", "skills", "gone"), join(skillsDir, "gone"), "dir");
    symlinkSync(join(workDir, "mine"), join(skillsDir, "mine"), "dir");
    expect(linkSkills({ checkoutDir, opsDir })).toEqual({ linked: ["a", "b"], kept_folders: [], removed: ["gone"] });
    expect(existsSync(join(skillsDir, "gone"))).toBe(false);
    expect(readlinkSync(join(skillsDir, "mine"))).toBe(join(workDir, "mine"));
  });

  it("does nothing without an ops clone, and nothing at all with --dry", () => {
    const { opsDir, checkoutDir, skillsDir } = opsAndCheckout();
    expect(linkSkills({ checkoutDir, opsDir: join(workDir, "no-ops") })).toEqual({ linked: [], kept_folders: [], removed: [] });
    expect(linkSkills({ checkoutDir, opsDir, isDry: true }).linked).toEqual(["a", "b"]);
    expect(existsSync(skillsDir)).toBe(false);
  });
});

describe("the settings", () => {
  it("adds the ops folders once and keeps everything else", () => {
    const before = JSON.stringify({ permissions: { allow: ["Bash(npm run ship)"] } });
    const after = withAdditionalDirectories(before, ["/home/j/zaisma-private/ops", "/home/j/zaisma-private/ops-sessions"]);
    expect(JSON.parse(after)).toEqual({ permissions: { allow: ["Bash(npm run ship)"], additionalDirectories: ["/home/j/zaisma-private/ops", "/home/j/zaisma-private/ops-sessions"] } });
    expect(withAdditionalDirectories(after, ["/home/j/zaisma-private/ops"])).toBe(after);
    expect(JSON.parse(withAdditionalDirectories("", ["/x"]))).toEqual({ permissions: { additionalDirectories: ["/x"] } });
  });
});
