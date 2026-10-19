import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_CONTENT, REVIEWED_CONTENT_RULES } from "@zaisma/core";
import { REVIEW_SET_PROTECTIONS, caseOutcome, checkCase, summarizeRun, type CaseResult } from "../../apps/site/src/review-set.ts";
// @ts-expect-error plain JavaScript without type declarations
import { BASELINE_FINGERPRINT_SHA256, reviewFingerprint } from "../../scripts/review-set/fingerprint.mjs";
// @ts-expect-error plain JavaScript without type declarations
import { GENERATED_PATH, publicCasesSource } from "../../scripts/review-set/bundle-public.mjs";

const ROOT = join(import.meta.dirname, "../..");
const CASES_DIRECTORY = join(ROOT, "review-set/cases");

interface PublicCase {
  name: string;
  file: Record<string, unknown>;
  paths: string[];
}

function filePathsUnder(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filePathsUnder(join(directory, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]));
}

const publicCases: PublicCase[] = readdirSync(CASES_DIRECTORY, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    name: entry.name,
    file: JSON.parse(readFileSync(join(CASES_DIRECTORY, entry.name, "case.json"), "utf8")),
    paths: filePathsUnder(join(CASES_DIRECTORY, entry.name, "game")),
  }));

describe("the public cases", () => {
  it("are all valid", () => {
    for (const gameCase of publicCases) expect(checkCase(gameCase.file, gameCase.paths), gameCase.name).toEqual([]);
  });

  it("cover every rule the review looks for with a rule-breaker, and every allowed kind with an honest game", () => {
    for (const rule of REVIEWED_CONTENT_RULES) {
      expect(publicCases.some((gameCase) => gameCase.file.is_honest === false && gameCase.file.content_rule === rule), `a rule-breaker for ${rule}`).toBe(true);
    }
    expect(publicCases.filter((gameCase) => gameCase.file.is_honest === true).length).toBeGreaterThanOrEqual(ALLOWED_CONTENT.length);
  });

  it("keep ways around a protection private: no public rule-breaker names a protection", () => {
    for (const gameCase of publicCases.filter((candidate) => candidate.file.is_honest === false)) expect(gameCase.file.protection, gameCase.name).toBe(null);
  });

  it("stay inert: nothing reaches a real address", () => {
    for (const gameCase of publicCases) {
      for (const path of gameCase.paths) {
        const text = readFileSync(join(CASES_DIRECTORY, gameCase.name, "game", path), "utf8");
        const hosts = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((match) => match[1]!.toLowerCase());
        for (const host of hosts) expect(host.endsWith(".invalid") || host === "zaisma.com", `${gameCase.name}/${path}: ${host}`).toBe(true);
      }
    }
  });
});

describe("the public cases in the Worker", () => {
  it("are current: run node scripts/review-set/bundle-public.mjs after changing a public case", () => {
    expect(readFileSync(GENERATED_PATH, "utf8")).toBe(publicCasesSource());
  });
});

describe("checkCase", () => {
  const good = { title: "T", description: "", is_honest: false, content_rule: "malware", protection: null, why: "Because." };
  it("accepts a good case", () => expect(checkCase(good, ["index.html"])).toEqual([]));
  it("refuses a missing why, an unknown key, an honest case with a rule, an unknown protection and no index.html", () => {
    expect(checkCase({ ...good, why: "" }, ["index.html"])).toHaveLength(1);
    expect(checkCase({ ...good, extra: 1 }, ["index.html"])[0]).toContain('Unknown key "extra"');
    expect(checkCase({ ...good, is_honest: true }, ["index.html"])[0]).toContain("honest case");
    expect(checkCase({ ...good, protection: "nope" }, ["index.html"])[0]).toContain('"protection"');
    expect(checkCase({ ...good, content_rule: "nope" }, ["index.html"])[0]).toContain("content_rule");
    expect(checkCase(good, ["game.js"])[0]).toContain("index.html");
    expect(Object.keys(REVIEW_SET_PROTECTIONS).length).toBeGreaterThan(0);
  });
});

describe("caseOutcome and summarizeRun", () => {
  it("names what the runs add up to", () => {
    expect(caseOutcome(false, ["held", "held", "held"])).toBe("held_bad");
    expect(caseOutcome(false, ["rejected", "rejected"])).toBe("held_bad");
    expect(caseOutcome(false, ["approved", "approved", "approved"])).toBe("missed_bad");
    expect(caseOutcome(true, ["approved", "approved", "approved"])).toBe("passed_honest");
    expect(caseOutcome(true, ["held", "held"])).toBe("held_honest");
    expect(caseOutcome(false, ["held", "approved", "held"])).toBe("inconsistent");
    // Held and rejected both stop a game.
    expect(caseOutcome(false, ["held", "rejected", "held"])).toBe("held_bad");
    expect(caseOutcome(true, ["held", "rejected"])).toBe("held_honest");
    expect(caseOutcome(true, ["approved", "held"])).toBe("inconsistent");
  });

  const result = (outcome: CaseResult["outcome"], isHonest: boolean, isPrivate = false): CaseResult => ({ name: outcome, is_honest: isHonest, content_rule: null, protection: null, is_private: isPrivate, decisions: [], finding_codes: [], outcome, declined_attempt_count: 1, declined_run_count: 0, cost_cents: 0.5, input_token_count: 10, output_token_count: 1 });
  it("counts, and passes only when every bad game is held and every honest one passes", () => {
    const passing = summarizeRun([result("held_bad", false), result("passed_honest", true, true)]);
    expect(passing).toMatchObject({ bad_case_count: 1, held_bad_case_count: 1, honest_case_count: 1, passed_honest_case_count: 1, inconsistent_case_count: 0, private_case_count: 1, is_passing: true, declined_attempt_count: 2, declined_review_count: 0, cost_cents: 1, input_token_count: 20, output_token_count: 2 });
    expect(summarizeRun([result("held_bad", false), result("held_honest", true)]).is_passing).toBe(false);
    expect(summarizeRun([result("inconsistent", false)]).is_passing).toBe(false);
    expect(summarizeRun([]).is_passing).toBe(false);
  });
});

describe("the gate on changing the review", () => {
  const lastRunPath = join(ROOT, "review-set/last-run.json");

  it("holds until a full run for the review as it is now has been committed", () => {
    if (!existsSync(lastRunPath)) {
      expect(BASELINE_FINGERPRINT_SHA256, "No review-set/last-run.json: run `npm run review-set` and commit it").toBe("");
      return;
    }
    const lastRun = JSON.parse(readFileSync(lastRunPath, "utf8")) as { fingerprint_sha256: string; summary: { is_passing: boolean } };
    expect(lastRun.fingerprint_sha256, "The review's prompt or model changed: run `npm run review-set` and commit review-set/last-run.json").toBe(reviewFingerprint(ROOT));
    if (lastRun.fingerprint_sha256 !== BASELINE_FINGERPRINT_SHA256) {
      expect(lastRun.summary.is_passing, "A changed review has to hold every bad game, pass every honest one and give each the same verdict every run").toBe(true);
    }
  });
});
