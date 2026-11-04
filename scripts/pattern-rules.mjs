#!/usr/bin/env node
// The pattern rules (docs/PATTERN-RULES.md): scanners that fail a change on a risky pattern in Zaisma's own code, never a game's.
//
//   npm run patterns                  Prints every finding, on this machine.
//   npm run patterns -- --compare <sha>   GitHub's check and npm run check: prints and fails only on what this change adds to <sha>.
//   npm run patterns -- --record <file>   Writes every finding to <file>, for a private repository to keep. Prints only counts.
//
// A public check's log is read by anyone, so --compare never prints a finding that's on the base too. This change's rules read both
// sides, so a new or changed rule's findings on old code subtract, and only what the change adds leaves this script.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findingsInSource } from "./pattern-rules/rules.mjs";
import { REVIEWED_SITES } from "./pattern-rules/reviewed-sites.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED_FOLDERS = ["apps", "packages"];
const SCANNED_FILE = /\.(ts|mjs|js)$/;
const NOT_SCANNED_FILE = /\.d\.ts$|\/generated\/|\/node_modules\/|\/dist\//;
const LOCAL_COMMAND = "npm run patterns -- --compare ";

const git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const stop = (line) => {
  console.error(line);
  process.exit(1);
};
const isScanned = (path) => SCANNED_FILE.test(path) && !NOT_SCANNED_FILE.test(path);
const siteGroupOf = ({ rule_id, source_path, symbol_name }) => `${rule_id} | ${source_path} | ${symbol_name}`;
const findingIdOf = ({ rule_id, symbol_name, site_text }) => `${rule_id} | ${symbol_name} | ${site_text}`;

/** The findings a reviewed site doesn't answer for: a function holding other than its count of sites has all of them looked at again. */
export function withoutReviewedSites(findings, reviewedSites = REVIEWED_SITES) {
  const counts = new Map();
  for (const finding of findings) counts.set(siteGroupOf(finding), (counts.get(siteGroupOf(finding)) ?? 0) + 1);
  const reviewedCounts = new Map(reviewedSites.map((site) => [siteGroupOf(site), site.site_count]));
  return findings.filter((finding) => reviewedCounts.get(siteGroupOf(finding)) !== counts.get(siteGroupOf(finding)));
}

/** What's in the first list and not the second, each finding counted as often as it's there. */
function findingsNotIn(findings, others) {
  const left = new Map();
  for (const other of others) left.set(findingIdOf(other), (left.get(findingIdOf(other)) ?? 0) + 1);
  return findings.filter((finding) => {
    const count = left.get(findingIdOf(finding)) ?? 0;
    if (count) left.set(findingIdOf(finding), count - 1);
    return !count;
  });
}

/**
 * What a change adds, from both sides' findings. Only "new_findings" may name them: where a new one comes with one gone of the same rule
 * in its file or function, it may be an old finding with its line changed, so that gives only a count, and still fails.
 */
export function comparePatternFindings({ headFindings, baseFindings }) {
  const newFindings = findingsNotIn(headFindings, baseFindings);
  if (!newFindings.length) return { outcome: "nothing_new", finding_count: 0, new_findings: [] };
  const goneFindings = findingsNotIn(baseFindings, headFindings);
  const mayBeOld = newFindings.some((finding) => goneFindings.some((gone) => gone.rule_id === finding.rule_id && (gone.source_path === finding.source_path || gone.symbol_name === finding.symbol_name)));
  if (mayBeOld) return { outcome: "count_only_fails", finding_count: newFindings.length, new_findings: [] };
  return { outcome: "new_findings", finding_count: newFindings.length, new_findings: newFindings };
}

/** What a comparison prints: the one place a finding can reach a public log. */
export function comparisonLines(comparison, baseSha) {
  switch (comparison.outcome) {
    case "nothing_new":
      return ["Pattern rules: this change adds nothing."];
    case "count_only_fails":
      return [`Pattern rules: ${comparison.finding_count} new, where the same rule lost one nearby. Run ${LOCAL_COMMAND}${baseSha} on your own machine.`];
    case "new_findings":
      return [
        `Pattern rules: this change adds ${comparison.finding_count}. docs/PATTERN-RULES.md says what to do instead.`,
        ...comparison.new_findings.map((finding) => `- ${finding.rule_id}, ${finding.source_path}:${finding.line_number}: ${finding.site_text}`),
      ];
  }
}

/** Every finding in these files, under a folder. */
function findingsIn(folder, paths) {
  return withoutReviewedSites(paths.filter(isScanned).flatMap((path) => findingsInSource(readFileSync(join(folder, path), "utf8"), path)));
}

/** The files this checkout tracks or has just added: anything git ignores, like the PhotoDNA SDK, is never opened. */
export function checkoutPaths(checkout) {
  return git(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...SCANNED_FOLDERS], checkout).stdout.split("\n").filter((path) => path && existsSync(join(checkout, path)));
}

export const findingsInCheckout = (checkout) => findingsIn(checkout, checkoutPaths(checkout));

/** Every finding on a commit, read from a copy of its files in a temporary folder. */
export function findingsOnCommit(checkout, baseSha, temporary) {
  const archive = join(temporary, "base.tar");
  if (git(["archive", "--format=tar", "-o", archive, baseSha, ...SCANNED_FOLDERS], checkout).status !== 0) return null;
  if (spawnSync("tar", ["-xf", archive, "-C", temporary]).status !== 0) return null;
  return findingsIn(temporary, git(["ls-tree", "-r", "--name-only", baseSha, "--", ...SCANNED_FOLDERS], checkout).stdout.split("\n").filter(Boolean));
}

function compare(baseSha) {
  const temporary = mkdtempSync(join(tmpdir(), "pattern-rules-"));
  try {
    const headFindings = findingsInCheckout(ROOT);
    // None on this change means there's nothing to subtract, so the base needn't be read.
    const baseFindings = headFindings.length ? findingsOnCommit(ROOT, baseSha, temporary) : [];
    if (!baseFindings) stop(`Pattern rules: couldn't read ${baseSha}. Run ${LOCAL_COMMAND}${baseSha} on your own machine.`);
    const comparison = comparePatternFindings({ headFindings, baseFindings });
    const lines = comparisonLines(comparison, baseSha).join("\n");
    if (comparison.outcome !== "nothing_new") stop(lines);
    console.log(lines);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function local() {
  const findings = findingsInCheckout(ROOT);
  for (const finding of findings) console.log(`- ${finding.rule_id}, ${finding.source_path}:${finding.line_number} (${finding.symbol_name}): ${finding.site_text}`);
  console.log(`Pattern rules: ${findings.length} findings.`);
  if (findings.length) process.exit(1);
}

function record(path) {
  const findings = findingsInCheckout(ROOT);
  writeFileSync(resolve(path), `${JSON.stringify({ recorded_at: new Date().toISOString(), commit_sha: git(["rev-parse", "HEAD"], ROOT).stdout.trim(), finding_count: findings.length, findings }, null, 1)}\n`);
  console.log(`Pattern rules: ${findings.length} findings.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag, given] = process.argv.slice(2);
  if (flag === "--compare" && given) compare(given);
  else if (flag === "--record" && given) record(given);
  else if (!flag) local();
  else stop("Use: npm run patterns [-- --compare <sha> | --record <file>]");
}
