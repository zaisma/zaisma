import { existsSync } from "node:fs";
import { join } from "node:path";
import { readMap, writeMap } from "./generate.mjs";
import { withVerdict } from "./schema.mjs";

/**
 * Day-one robust verdicts from what the repo's tests and ship checks already prove, spending no review on
 * them. Each rule cites only what its test covers, and records the door's anchor hashes with the verdict,
 * so a moved guard makes the seeded case stale: robust is never a permanent free pass. Only unexplored
 * cases are seeded; a stale one waits for the night's review, and a hole, weak spot or fix is never
 * touched.
 */

const isSitePage = (door) => (door.door_kind === "page_route" || door.door_kind === "page_form") && door.door_id.startsWith("page:");
const isGameFile = (door, addresses) => door.door_kind === "game_file_address" && addresses.includes(door.door_id);
const SERVED_GAME_FILES = ["game-file:/", "game-file:/<file>"];

export const SEED_RULES = [
  {
    evidence: { kind: "test", ref: "test/site/access-checks.test.ts", note: "Every API call is made as a stranger, with each key too weak for it, with a key for other games, with an undeclared input and with an input that needs more." },
    appliesTo: (door) => door.door_kind === "api_call",
    caseIds: ["other-account-id", "weaker-key-level", "other-games-key", "undeclared-input", "input-needs-higher-access"],
  },
  {
    evidence: { kind: "test", ref: "test/site/strict-scripts.test.ts", note: "Every zaisma.com page runs only the site's own script files (no inline scripts, by CSP); test/node/strict-scripts.test.ts keeps inline scripts and handlers out of the code." },
    appliesTo: isSitePage,
    caseIds: ["injected-script-runs"],
  },
  {
    evidence: { kind: "test", ref: "test/games/serve.test.ts", note: "Held, pending and draft games aren't served; a draft opens only through its preview link; path tricks are refused." },
    appliesTo: (door) => isGameFile(door, SERVED_GAME_FILES),
    caseIds: ["private-game-file-public", "draft-or-unlisted-public", "path-traversal", "held-game-visible"],
  },
  {
    evidence: { kind: "test", ref: "test/games/serve.test.ts", note: "A tester link opens what it chooses until it's turned off or ends." },
    appliesTo: (door) => isGameFile(door, ["game-file:--tester"]),
    caseIds: ["tester-link-after-off"],
  },
  {
    evidence: { kind: "test", ref: "test/games/serve.test.ts", note: "A draft opens only through its preview link, and a stale or another game's grant opens nothing." },
    appliesTo: (door) => isGameFile(door, ["game-file:--preview"]),
    caseIds: ["preview-link-after-off"],
  },
  {
    evidence: { kind: "test", ref: "test/site/accounts.test.ts", note: "Forms posted from other sites are refused; password tries on one username are limited from any address." },
    appliesTo: (door) => door.door_id === "page:POST /signin",
    caseIds: ["cross-site-post", "rate-or-lockout-missing"],
  },
  {
    evidence: { kind: "test", ref: "test/site/accounts.test.ts", note: "Email codes: one live code per address, dead after 5 tries or 10 minutes, and asking is limited." },
    appliesTo: (door) => door.door_id === "page:POST /signin/email" || door.door_id === "page:POST /signin/code",
    caseIds: ["rate-or-lockout-missing"],
  },
  {
    evidence: { kind: "test", ref: "test/site/accounts.test.ts", note: "Forged session cookies are ignored." },
    appliesTo: (door) => door.door_id === "token:session",
    caseIds: ["forged"],
  },
  {
    evidence: { kind: "test", ref: "test/site/accounts.test.ts", note: "An email code is dead after 5 tries or 10 minutes, and one live code per address." },
    appliesTo: (door) => door.door_id === "token:email_code",
    caseIds: ["replayed-after-expiry"],
  },
  {
    evidence: { kind: "test", ref: "test/site/stored-values.test.ts", note: "Every door the value's entry lists is sent a value outside its shape and keeps none; the value planted hostile in the database shows only as text on every page, and exactly where its entry says." },
    appliesTo: (door) => door.door_kind === "stored_value",
    caseIds: ["format-skipped", "shown-in-wrong-context"],
  },
  {
    evidence: { kind: "test", ref: "test/site/api-mcp-parity.test.ts", note: "Every call a tool makes is a real API call, and every API call has its tool." },
    appliesTo: (door) => door.door_kind === "mcp_tool",
    caseIds: ["tool-maps-to-declared-route"],
  },
  {
    evidence: { kind: "ship_check", ref: "scripts/ship-checks.mjs", note: "Ship check: the private check game stays closed on the game domain, on every ship." },
    appliesTo: (door) => isGameFile(door, SERVED_GAME_FILES),
    caseIds: ["private-game-file-public"],
    requiresFile: true,
  },
  {
    evidence: { kind: "ship_check", ref: "scripts/ship-checks.mjs", note: "Ship check: zaisma.com's security headers and https, on every ship." },
    appliesTo: (door) => door.door_kind === "page_route" && door.door_id.startsWith("page:"),
    caseIds: ["missing-security-header"],
    requiresFile: true,
  },
  {
    evidence: { kind: "ship_check", ref: "scripts/ship-checks.mjs", note: "Ship check: /admin is behind Cloudflare Access, on every ship." },
    appliesTo: (door) => door.door_kind === "admin_tool",
    caseIds: ["reached-without-access"],
    requiresFile: true,
  },
];

/**
 * The map with every SEED_RULES case set robust where it's still unexplored. A rule with requiresFile
 * seeds nothing while its ref isn't in the repo (a sibling slice's file that hasn't merged). Answers the
 * new map and the case refs it seeded.
 */
export function seedRobust(map, { repoRoot, now, rules = SEED_RULES }) {
  const activeRules = rules.filter((rule) => !rule.requiresFile || existsSync(join(repoRoot, rule.evidence.ref)));
  const seededCaseRefs = [];
  const next = map.map((sector) => ({
    ...sector,
    doors: sector.doors.map((door) => {
      if (door.door_removed_at) return door;
      const caseIds = new Map();
      for (const rule of activeRules) if (rule.appliesTo(door)) for (const caseId of rule.caseIds) if (!caseIds.has(caseId)) caseIds.set(caseId, rule.evidence);
      if (caseIds.size === 0) return door;
      const hashes = Object.fromEntries(door.anchors.map((anchor) => [anchor.anchor_id, anchor.source_hash_sha256]));
      if (Object.values(hashes).some((hash) => hash === null)) return door;
      return {
        ...door,
        cases: door.cases.map((theCase) => {
          const evidence = caseIds.get(theCase.case_id);
          if (!evidence || theCase.status !== "unexplored") return theCase;
          seededCaseRefs.push(`${door.door_id}#${theCase.case_id}`);
          return withVerdict(theCase, { status: "robust", evidence, verdict_at: now, verdict_anchor_hashes: hashes });
        }),
      };
    }),
  }));
  return { map: next, seeded_case_refs: seededCaseRefs };
}

/** Seeds the map in mapDir. Run after generate, so the doors' anchor hashes are today's. */
export function seedMapDir({ repoRoot, mapDir, now = new Date().toISOString() }) {
  const { map, seeded_case_refs } = seedRobust(readMap(mapDir), { repoRoot, now });
  writeMap(mapDir, map);
  return seeded_case_refs;
}
