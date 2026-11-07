import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DOOR_ROW_ANCHOR_ID, limitOf, readMap, rowHashOf, writeMap } from "./generate.mjs";
import { caseRefOf, withStale, withVerdict } from "./schema.mjs";

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

/** The checklist case a door's own limit answers. */
export const NO_LIMIT_CASE_ID = "rate-or-lockout-missing";
/** Where the contract grid calls each kind of door past its own limit, by the door id's start. */
const PAST_LIMIT_GRID_FILES = {
  "page:": "test/grid/page-doors.ts",
  "api:": "test/grid/api.grid.ts",
  "rooms:": "test/grid/rooms.grid.ts",
  "room-message:": "test/grid/rooms.grid.ts",
};
/**
 * Whether the door's row states a limit of its own: a level on the door's own counter or a group it names, but not an address's
 * counter shared between doors, which a Worker keeps in front of every address it serves (rooms, the game domain). Such a door has
 * nothing of its own for the grid to prove, so its No limit case stays the night's: whether one counter there is enough.
 */
const hasOwnLimit = (door) => {
  const limit = limitOf(door);
  return Boolean(limit && "level" in limit && !(limit.counts === "address" && limit.group));
};
/** Whether the grid's last run on main proved the door's own limit: its past_limit cell kept (scripts/contract-grid.mjs --record). */
const isPastLimitProven = (door, grid) => hasOwnLimit(door) && Boolean(grid?.past_limit_kept_door_ids?.includes(door.door_id));
/**
 * Why the door's own limit no longer holds as seeded, or null: its row no longer states one, or its past_limit cell failed on the
 * grid's last run on main. A file that couldn't run proves nothing either way; the grid counts it as a failure of its own.
 */
const pastLimitStaleReason = (door, grid) => {
  if (!hasOwnLimit(door)) return "its row no longer states a limit of its own";
  return grid?.failures?.some((cell) => cell.door_id === door.door_id && cell.caller_kind === "past_limit") ? "its past_limit cell failed on the contract grid's last run on main" : null;
};
const isPastLimitVerdict = (theCase) => theCase.case_id === NO_LIMIT_CASE_ID && Object.values(PAST_LIMIT_GRID_FILES).includes(theCase.evidence?.ref) && DOOR_ROW_ANCHOR_ID in (theCase.verdict_anchor_hashes ?? {});

const PAST_LIMIT_RULES = Object.entries(PAST_LIMIT_GRID_FILES).map(([doorIdStart, ref]) => ({
  evidence: { kind: "test", ref, note: "The contract grid calls the door past its own limit: only the door's own counter refuses, the shared ones in front of it let the call through, and the door must refuse. From that cell passing on main's last grid run; a change to the door's row in its table makes this stale." },
  appliesTo: (door, { grid }) => door.door_id.startsWith(doorIdStart) && isPastLimitProven(door, grid),
  caseIds: [NO_LIMIT_CASE_ID],
  isOnDoorRow: true,
}));

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
  ...PAST_LIMIT_RULES,
];

/**
 * The map with every SEED_RULES case set robust where it's still unexplored. A rule with requiresFile
 * seeds nothing while its ref isn't in the repo (a sibling slice's file that hasn't merged). grid: the
 * contract grid's last record on main, or null; a door's own limit seeded from it goes stale once its
 * cell fails there or its row stops stating a limit of its own. Answers the new map, the case refs it seeded and the ones it made stale.
 */
export function seedRobust(map, { repoRoot, now, rules = SEED_RULES, grid = null }) {
  const activeRules = rules.filter((rule) => !rule.requiresFile || existsSync(join(repoRoot, rule.evidence.ref)));
  const seededCaseRefs = [];
  const staleCaseRefs = [];
  const next = map.map((sector) => ({
    ...sector,
    doors: sector.doors.map((door) => {
      if (door.door_removed_at) return door;
      const rulesByCaseId = new Map();
      for (const rule of activeRules) if (rule.appliesTo(door, { grid })) for (const caseId of rule.caseIds) if (!rulesByCaseId.has(caseId)) rulesByCaseId.set(caseId, rule);
      const isGridRead = Array.isArray(grid?.past_limit_kept_door_ids);
      const staleCases = (theCase) => {
        const staleReason = isGridRead && theCase.status === "robust" && isPastLimitVerdict(theCase) ? pastLimitStaleReason(door, grid) : null;
        if (!staleReason) return theCase;
        staleCaseRefs.push(caseRefOf(door, theCase));
        return withStale(theCase, staleReason);
      };
      const hashes = Object.fromEntries(door.anchors.map((anchor) => [anchor.anchor_id, anchor.source_hash_sha256]));
      if (rulesByCaseId.size === 0 || Object.values(hashes).some((hash) => hash === null)) return { ...door, cases: door.cases.map(staleCases) };
      return {
        ...door,
        cases: door.cases.map((theCase) => {
          const rule = rulesByCaseId.get(theCase.case_id);
          if (!rule || theCase.status !== "unexplored") return staleCases(theCase);
          seededCaseRefs.push(`${door.door_id}#${theCase.case_id}`);
          return withVerdict(theCase, { status: "robust", evidence: rule.evidence, verdict_at: now, verdict_anchor_hashes: rule.isOnDoorRow ? { ...hashes, [DOOR_ROW_ANCHOR_ID]: rowHashOf(door) } : hashes });
        }),
      };
    }),
  }));
  return { map: next, seeded_case_refs: seededCaseRefs, stale_case_refs: staleCaseRefs };
}

/** The contract grid's last record on main (grid/failures.json in the map's directory), or null before its first. */
const readGrid = (mapDir) => {
  const path = join(mapDir, "grid", "failures.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
};

/** Seeds the map in mapDir. Run after generate, so the doors' anchor hashes are today's. Answers the case refs it seeded and the ones it made stale. */
export function seedMapDir({ repoRoot, mapDir, now = new Date().toISOString() }) {
  const { map, seeded_case_refs, stale_case_refs } = seedRobust(readMap(mapDir), { repoRoot, now, grid: readGrid(mapDir) });
  writeMap(mapDir, map);
  return { seeded_case_refs, stale_case_refs };
}
