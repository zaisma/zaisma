import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { temporaryFolder } from "../temporary-folder.ts";
// @ts-expect-error: a Node script with no types of its own.
import { WORKFLOW_FILE, flattenedPictures, isPicturesFolder, pagePrefix, pagesOfJobs, pathSlug, readInput, verdictLine } from "../../scripts/pictures.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { picturesRefusal } from "../../scripts/motion-sheet.mjs";

/** npm run pictures (scripts/pictures.mjs) and .github/workflows/pictures.yml: the art review's pictures, made on GitHub's runners. */
const ROOT = join(import.meta.dirname, "../..");
const workflow = readFileSync(join(ROOT, ".github/workflows/pictures.yml"), "utf8");
const check = readFileSync(join(ROOT, ".github/workflows/check.yml"), "utf8");

describe("npm run pictures", () => {
  it("takes a pull request, each page's whole path and a folder, and nothing else", () => {
    expect(readInput(["--pr", "214", "--path", "/", "--path", "/g/cave-crew", "--path", "/", "--out", "art"])).toEqual({ pullRequestNumber: 214, pagePaths: ["/", "/g/cave-crew"], outFolder: "art", isJson: false });
    expect(readInput(["--pr", "214", "--path", "/", "--out", "art", "--json"]).isJson).toBe(true);
    expect(readInput(["--path", "/", "--out", "art"]).error.message).toMatch(/--pr/);
    expect(readInput(["--pr", "214", "--out", "art"]).error.message).toMatch(/--path/);
    expect(readInput(["--pr", "214", "--path", "/", "--path", "g/x", "--out", "art"]).error.message).toMatch(/isn't a page's path/);
    expect(readInput(["--pr", "214", "--path", "/$(rm)", "--out", "art"]).error.message).toMatch(/isn't a page's path/);
    expect(readInput(["--pr", "214", "--path", "/", "--only", "/"]).error.message).toMatch(/Unknown option --only/);
    expect(readInput(["--pr", "214", "--path", "/", "--out"]).error.message).toMatch(/--out takes a value/);
  });

  it("keeps a picture two pages both make under each page's name", () => {
    expect(pathSlug("/")).toBe("home");
    expect(pathSlug("/g/cave-crew?play")).toBe("g-cave-crew-play");
    const flat = flattenedPictures([
      { page_path: "/", folder: "a", names: ["Home.png", "Sign in sheet.png"] },
      { page_path: "/games", folder: "b", names: ["Games.png", "Sign in sheet.png"] },
    ]);
    expect(flat.map((each: { name: string }) => each.name)).toEqual(["Home.png", `${pagePrefix("/")}--Sign in sheet.png`, "Games.png", `${pagePrefix("/games")}--Sign in sheet.png`]);
    expect(pagePrefix("/")).toMatch(/^home-[0-9a-f]{6}$/);
    // Two paths with one slug still get two names.
    expect(pathSlug("/g/a-b")).toBe(pathSlug("/g/a/b"));
    const sameSlug = flattenedPictures([{ page_path: "/g/a-b", folder: "a", names: ["Game page.png"] }, { page_path: "/g/a/b", folder: "b", names: ["Game page.png"] }]);
    expect(new Set(sameSlug.map((each: { name: string }) => each.name)).size).toBe(2);
  });

  it("joins each page's two jobs, and says a job that left nothing is missing", () => {
    const pages = pagesOfJobs([
      { page_path: "/", check_kind: "layout", check_outcome: "success", folder: "runs/pictures-0" },
      { page_path: "/", check_kind: "motion", check_outcome: "failure", folder: "runs/pictures-1" },
      { page_path: "/games", check_kind: "layout", check_outcome: "success", folder: "runs/pictures-2" },
    ], ["/", "/games"]);
    expect(pages).toEqual([
      { page_path: "/", layout_outcome: "success", motion_outcome: "failure", layout_output_path: join("runs/pictures-0", "layout.txt"), motion_output_path: join("runs/pictures-1", "motion.txt") },
      { page_path: "/games", layout_outcome: "success", motion_outcome: "missing", layout_output_path: join("runs/pictures-2", "layout.txt"), motion_output_path: null },
    ]);
    expect(verdictLine(pages)).toMatch(/^PICTURES FAIL: \/ \(layout check success, motion sheet failure\); \/games \(layout check success, motion sheet missing\)/);
  });

  it("writes only a new or empty folder, or one it filled before", () => {
    const root = temporaryFolder("zaisma-pictures-");
    expect(isPicturesFolder(join(root, "new"))).toBe(true);
    expect(isPicturesFolder(root)).toBe(true);
    writeFileSync(join(root, "notes.md"), "mine");
    expect(isPicturesFolder(root)).toBe(false);
    writeFileSync(join(root, "pictures.json"), "{}");
    expect(isPicturesFolder(root)).toBe(true);
  });

  it("passes only when every page's layout check and motion sheet passed", () => {
    expect(verdictLine([{ page_path: "/", layout_outcome: "success", motion_outcome: "success" }])).toMatch(/^PICTURES PASS/);
    expect(verdictLine([{ page_path: "/", layout_outcome: "success", motion_outcome: "failure" }])).toMatch(/^PICTURES FAIL: \/ \(layout check success, motion sheet failure\)/);
    expect(verdictLine([])).toMatch(/^PICTURES FAIL/);
  });

  it("refuses motion pictures on a person's machine, never on GitHub", () => {
    expect(picturesRefusal({ isOnGithub: false, picturesFolder: "strips" })).toMatch(/npm run pictures/);
    expect(picturesRefusal({ isOnGithub: true, picturesFolder: "strips" })).toBeNull();
    expect(picturesRefusal({ isOnGithub: false, picturesFolder: null })).toBeNull();
  });
});

describe("the Pictures workflow", () => {
  it("is dispatched with the inputs npm run pictures sends, and names its run by the ask", () => {
    expect(WORKFLOW_FILE).toBe("pictures.yml");
    for (const input of ["pull_request_number", "head_sha", "page_paths", "request_id"]) expect(workflow).toContain(`      ${input}:`);
    expect(workflow).toMatch(/run-name: .*\(\$\{\{ inputs\.request_id \}\}\)/);
    expect(workflow).toContain("workflow_dispatch:");
  });

  it("makes each page's pictures with an exact path, the inputs only through the environment", () => {
    expect(workflow).toContain('npm run layout:check -- --path "$PAGE_PATH" --screens all --pictures pictures/sheets');
    expect(workflow).toContain('npm run motion:sheet -- --path "$PAGE_PATH" --pictures pictures/strips');
    // An input written into a script runs as code: every run step reads them from env.
    const lines = workflow.split("\n");
    const runLines = lines.flatMap((line, index): string[] => {
      const start = /^(\s+)(- )?run: (.*)$/.exec(line);
      if (!start) return [];
      const indent = (start[1] ?? "").length + (start[2] ? 2 : 0);
      const block: string[] = [];
      for (const next of lines.slice(index + 1)) {
        if (next.trim() !== "" && next.search(/\S/) <= indent) break;
        block.push(next);
      }
      return [start[3] ?? "", ...block];
    });
    expect(runLines.length).toBeGreaterThan(10);
    expect(runLines.filter((line) => /\$\{\{ (inputs|matrix)\./.test(line))).toEqual([]);
  });

  it("finds the preview's test data by the same files as the check", () => {
    const seedLine = (text: string) => /seed_hash="\$\(git ls-files [^\n]+/.exec(text)?.[0];
    expect(seedLine(workflow)).toBeTruthy();
    expect(seedLine(workflow)).toBe(seedLine(check));
  });
});

describe("the pictures workflow's run name", () => {
  it("is quoted, so YAML doesn't read its # as a comment and drop the request id npm run pictures finds the run by", () => {
    const runName = workflow.match(/^run-name:\s*(.*)$/m)?.[1] ?? "";
    expect(runName.startsWith('"') && runName.endsWith('"')).toBe(true);
    expect(runName).toContain("${{ inputs.request_id }}");
  });
});
