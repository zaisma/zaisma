#!/usr/bin/env node
// Connects this machine's Zaisma checkout to the private ops repo (zaisma/ops), for the people who run Zaisma.
// Anyone else can ignore it: nothing in the code needs ops.
//
//   node scripts/ops-setup.mjs           clone ops to ~/zaisma-private/ops (or pull it), link its skills into the main
//                                        checkout's .claude/skills/, and let sessions read and edit the ops clone and its
//                                        session worktrees (.claude/settings.local.json); says what it did
//   node scripts/ops-setup.mjs --links   only the skill links, quietly; does nothing without an ops clone (npm run ship
//                                        and the session-start hook run this)
//   --dry says what it would do; --json answers as JSON.
//
// Sessions in the desktop app's worktrees load skills and settings from the main checkout's root, so that's the one
// place it changes, and only two things there, both gitignored: one link per skill in .claude/skills/, and
// permissions.additionalDirectories in .claude/settings.local.json. A skill folder that's still a real folder (the
// tracked copy before this repo stopped holding skills) is left alone until a pull removes it.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const OPS_REPO = "zaisma/ops";

/** Where the ops clone and its session worktrees are (ZAISMA_OPS_DIR and ZAISMA_OPS_SESSIONS_DIR, as scripts/ops.mjs reads them). */
export function opsPlacesOf(environment = process.env) {
  return {
    opsDir: resolve(environment.ZAISMA_OPS_DIR || join(homedir(), "zaisma-private", "ops")),
    sessionsDir: resolve(environment.ZAISMA_OPS_SESSIONS_DIR || join(homedir(), "zaisma-private", "ops-sessions")),
  };
}

/** The main checkout of the repo this runs in: the folder that holds the shared .git. */
export function mainCheckoutOf(cwd = process.cwd()) {
  return dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8" }).trim());
}

const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * One link per ops skill in <checkoutDir>/.claude/skills/: made where nothing is, pointed again where a link points
 * elsewhere, removed where it points at a skill ops no longer has. A real folder is never touched.
 * Answers { linked, kept_folders, removed } as skill names.
 */
export function linkSkills({ checkoutDir, opsDir, isDry = false }) {
  const opsSkillsDir = join(opsDir, ".claude", "skills");
  const skillsDir = join(checkoutDir, ".claude", "skills");
  const answer = { linked: [], kept_folders: [], removed: [] };
  if (!existsSync(opsSkillsDir)) return answer;
  const skillNames = readdirSync(opsSkillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (!isDry) mkdirSync(skillsDir, { recursive: true });
  for (const name of skillNames) {
    const linkPath = join(skillsDir, name);
    const target = join(opsSkillsDir, name);
    if (isLink(linkPath)) {
      if (readlinkSync(linkPath) === target) continue;
      if (!isDry) rmSync(linkPath);
    } else if (existsSync(linkPath)) {
      answer.kept_folders.push(name);
      continue;
    }
    if (!isDry) symlinkSync(target, linkPath, "dir");
    answer.linked.push(name);
  }
  for (const name of existsSync(skillsDir) ? readdirSync(skillsDir) : []) {
    const linkPath = join(skillsDir, name);
    if (isLink(linkPath) && readlinkSync(linkPath).startsWith(opsSkillsDir) && !skillNames.includes(name)) {
      if (!isDry) rmSync(linkPath);
      answer.removed.push(name);
    }
  }
  return answer;
}

/** settings.local.json's text with each folder in permissions.additionalDirectories, everything else kept. */
export function withAdditionalDirectories(settingsText, folders) {
  const settings = settingsText.trim() ? JSON.parse(settingsText) : {};
  const permissions = (settings.permissions ??= {});
  const directories = (permissions.additionalDirectories ??= []);
  for (const folder of folders) if (!directories.includes(folder)) directories.push(folder);
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** The ops clone made or pulled, through ops.mjs once it's there. Answers what happened. */
function cloneOrPull(opsDir, isDry) {
  if (existsSync(join(opsDir, "scripts", "ops.mjs"))) {
    if (isDry) return "would pull";
    return execFileSync(process.execPath, [join(opsDir, "scripts", "ops.mjs"), "pull", "--json"], { encoding: "utf8", env: { ...process.env, ZAISMA_OPS_DIR: opsDir } }).match(/"clone": "([^"]+)"/)?.[1] ?? "pulled";
  }
  if (existsSync(opsDir)) throw new Error(`${opsDir} exists but isn't a clone of ${OPS_REPO}. Move it aside and run this again.`);
  if (isDry) return "would clone";
  mkdirSync(dirname(opsDir), { recursive: true });
  execFileSync("gh", ["repo", "clone", OPS_REPO, opsDir, "--", "--quiet"], { stdio: ["ignore", "ignore", "pipe"] });
  execFileSync(process.execPath, [join(opsDir, "scripts", "ops.mjs"), "pull"], { stdio: "ignore", env: { ...process.env, ZAISMA_OPS_DIR: opsDir } });
  return "cloned";
}

export function setUp({ checkoutDir, opsDir, sessionsDir, isDry = false }) {
  const clone = cloneOrPull(opsDir, isDry);
  const links = linkSkills({ checkoutDir, opsDir, isDry });
  const settingsPath = join(checkoutDir, ".claude", "settings.local.json");
  const before = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : "";
  const after = withAdditionalDirectories(before, [opsDir, sessionsDir]);
  const isSettingsChanged = after !== before && JSON.stringify(JSON.parse(after)) !== JSON.stringify(before.trim() ? JSON.parse(before) : {});
  if (isSettingsChanged && !isDry) writeFileSync(settingsPath, after);
  return { main_checkout: checkoutDir, ops_dir: opsDir, clone, ...links, settings_path: settingsPath, is_settings_changed: isSettingsChanged, ...(isDry ? { is_dry: true } : {}) };
}

function main() {
  const flags = process.argv.slice(2);
  const unknown = flags.filter((flag) => !["--links", "--dry", "--json"].includes(flag));
  if (unknown.length) {
    console.error(`Unknown option ${unknown[0]}. Options: --links, --dry, --json.`);
    process.exit(1);
  }
  const isDry = flags.includes("--dry");
  const isJson = flags.includes("--json");
  const { opsDir, sessionsDir } = opsPlacesOf();
  const checkoutDir = mainCheckoutOf();
  if (flags.includes("--links")) {
    if (!existsSync(join(opsDir, ".claude", "skills"))) return;
    const links = linkSkills({ checkoutDir, opsDir, isDry });
    if (isJson) console.log(JSON.stringify(links, null, 2));
    else if (links.linked.length || links.removed.length) console.log(`Ops skills: linked ${links.linked.join(", ") || "none"}; removed ${links.removed.join(", ") || "none"}.`);
    return;
  }
  const answer = setUp({ checkoutDir, opsDir, sessionsDir, isDry });
  if (isJson) {
    console.log(JSON.stringify(answer, null, 2));
    return;
  }
  console.log(`Ops clone at ${opsDir}: ${answer.clone}.`);
  const skillsLine = answer.clone === "would clone" ? "linked once the clone is there" : answer.linked.length ? `linked ${answer.linked.join(", ")}` : answer.kept_folders.length ? "none linked yet" : "all linked already";
  console.log(`Skills in ${join(checkoutDir, ".claude", "skills")}: ${skillsLine}${answer.removed.length ? `; removed ${answer.removed.join(", ")}` : ""}.`);
  if (answer.kept_folders.length) console.log(`Still real folders, left as they are until the main checkout pulls the change that removes them (npm run ship re-links then): ${answer.kept_folders.join(", ")}.`);
  console.log(`${answer.settings_path}: ${answer.is_settings_changed ? `sessions may now read and edit ${opsDir} and ${sessionsDir}` : "already lets sessions reach ops"}.`);
  if (isDry) console.log("(--dry: nothing changed.)");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
