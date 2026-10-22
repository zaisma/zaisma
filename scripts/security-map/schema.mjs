/**
 * The security map's model, as constants and pure helpers (no I/O). Zaisma's security is drawn as sectors
 * (what an attacker wants) → doors (every way in, generated from the code) → cases (a finite attack
 * checklist per door kind, checklists.json). A case is unexplored, robust (with evidence), weak (a soft
 * spot, no exploit), hole (proven; its detail kept in the private repo's findings/), fixed (a test guards
 * it) or stale (the code its verdict relied on changed). The skill (.claude/skills/security-map) says how
 * it's read and kept.
 */

/** What an attacker wants, in order. Adding a sector is adding an entry here. */
export const SECTORS = [
  { sector_id: "accounts", sector_name: "Accounts", attacker_goal: "Get into an account or act as its owner." },
  { sector_id: "api-keys", sector_name: "API keys", attacker_goal: "Use a developer's API key, sign-in app or webhook beyond its limits." },
  { sector_id: "games-and-files", sector_name: "Games and files", attacker_goal: "Reach or change another game, its files, versions or secrets." },
  { sector_id: "player-data", sector_name: "Player data", attacker_goal: "Read or change a player's saves or a game's database across accounts." },
  { sector_id: "rooms", sector_name: "Rooms", attacker_goal: "Join, forge or read a multiplayer room a player shouldn't." },
  { sector_id: "zaisma-keys-and-admin", sector_name: "Zaisma's keys and admin", attacker_goal: "Reach Zaisma's admin, keys or own secrets." },
];

export const SECTOR_IDS = SECTORS.map((sector) => sector.sector_id);

export const DOOR_KINDS = ["api_call", "mcp_tool", "admin_tool", "page_form", "page_route", "game_file_address", "room_message", "token_or_session", "stored_value"];

/** What a case can be stored as. A night's "recheck" is a frontier bucket, never a stored status. */
export const STATUSES = ["unexplored", "robust", "weak", "hole", "fixed", "stale"];

/** On weak and hole cases only. The Nightly security review decides which. */
export const SEVERITY_TIERS = ["urgent", "important", "hardening"];

/** What proves a verdict. A hole's repro is never evidence: it stays in the private finding. */
export const EVIDENCE_KINDS = ["test", "ship_check", "probe"];

/** Statuses whose verdict needs evidence, and the ones a sector counts as done. */
export const STATUSES_WITH_EVIDENCE = ["robust", "weak", "fixed"];
export const DONE_STATUSES = ["robust", "fixed"];

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** "<door_id>#<case_id>": one case anywhere on the map. */
export const caseRefOf = (door, theCase) => `${door.door_id}#${theCase.case_id}`;

/** A case as first drawn: nothing known yet. */
export function unexploredCase({ case_id, case_name }) {
  return { case_id, case_name, status: "unexplored", severity_tier: null, evidence: null, finding_id: null, verdict_at: null, verdict_anchor_hashes: null, stale_reason: null };
}

/** The same case with its fields in the stored order, so map files diff cleanly. */
export function orderedCase(theCase) {
  return {
    case_id: theCase.case_id,
    case_name: theCase.case_name,
    status: theCase.status,
    severity_tier: theCase.severity_tier ?? null,
    evidence: theCase.evidence ? { kind: theCase.evidence.kind, ref: theCase.evidence.ref, note: theCase.evidence.note ?? "" } : null,
    finding_id: theCase.finding_id ?? null,
    verdict_at: theCase.verdict_at ?? null,
    verdict_anchor_hashes: theCase.verdict_anchor_hashes ? Object.fromEntries(Object.entries(theCase.verdict_anchor_hashes).sort(([first], [second]) => first.localeCompare(second))) : null,
    stale_reason: theCase.stale_reason ?? null,
  };
}

function evidenceProblems(evidence) {
  if (!evidence || typeof evidence !== "object") return ["has no evidence"];
  const problems = [];
  if (!EVIDENCE_KINDS.includes(evidence.kind)) problems.push(`has evidence of kind ${JSON.stringify(evidence.kind)}, not one of ${EVIDENCE_KINDS.join(", ")}`);
  if (typeof evidence.ref !== "string" || !evidence.ref) problems.push("has evidence with no ref");
  return problems;
}

/** What's wrong with a case's status and fields; [] when it's valid. */
export function caseStatusProblems(theCase) {
  const problems = [];
  const { status } = theCase;
  if (!STATUSES.includes(status)) return [`has status ${JSON.stringify(status)}, not one of ${STATUSES.join(", ")}`];
  if (STATUSES_WITH_EVIDENCE.includes(status)) problems.push(...evidenceProblems(theCase.evidence));
  if (status === "hole") {
    if (theCase.evidence) problems.push("is a hole carrying evidence: a hole's detail stays in its finding, by finding_id");
    if (!theCase.finding_id) problems.push("is a hole with no finding_id");
  }
  if (status === "hole" || status === "weak") {
    if (!SEVERITY_TIERS.includes(theCase.severity_tier)) problems.push(`is ${status} with severity_tier ${JSON.stringify(theCase.severity_tier ?? null)}, not one of ${SEVERITY_TIERS.join(", ")}`);
  } else if (status !== "stale" && theCase.severity_tier) problems.push(`is ${status} with a severity_tier, which only weak and hole cases carry`);
  if (status === "unexplored") {
    if (theCase.evidence) problems.push("is unexplored with evidence");
    if (theCase.verdict_anchor_hashes) problems.push("is unexplored with verdict_anchor_hashes");
    if (theCase.verdict_at) problems.push("is unexplored with a verdict_at");
  } else {
    if (!theCase.verdict_anchor_hashes || typeof theCase.verdict_anchor_hashes !== "object") problems.push(`is ${status} with no verdict_anchor_hashes`);
    if (!theCase.verdict_at) problems.push(`is ${status} with no verdict_at`);
  }
  if (status === "stale" && !theCase.stale_reason) problems.push("is stale with no stale_reason");
  if (theCase.verdict_at && !ISO_TIME.test(theCase.verdict_at)) problems.push(`has verdict_at ${JSON.stringify(theCase.verdict_at)}, not an ISO time in UTC`);
  return problems;
}

/** Whether a case may be set robust: only with evidence, and never over an open hole. */
export function canSetRobust(theCase) {
  return evidenceProblems(theCase.evidence).length === 0 && !(theCase.status === "hole" || (theCase.status === "stale" && theCase.finding_id));
}

/**
 * The case with a verdict recorded: its status, what proves it, and the door's anchor hashes now, so it
 * goes stale when that code changes. Throws when the result breaks the status rules.
 */
export function withVerdict(theCase, { status, evidence = null, severity_tier = null, finding_id = theCase.finding_id ?? null, verdict_at, verdict_anchor_hashes }) {
  const next = orderedCase({ ...theCase, status, evidence: STATUSES_WITH_EVIDENCE.includes(status) ? evidence : null, severity_tier, finding_id, verdict_at, verdict_anchor_hashes, stale_reason: null });
  if (status === "robust" && !canSetRobust({ ...theCase, evidence })) throw new Error(`${theCase.case_id} can't be set robust: it needs evidence, and an open hole stays open until it's fixed.`);
  const problems = caseStatusProblems(next);
  if (problems.length) throw new Error(`${theCase.case_id} ${problems.join("; ")}.`);
  return next;
}

/** The case marked stale, keeping what it was (evidence, finding, tier) for the next look. */
export function withStale(theCase, staleReason) {
  return orderedCase({ ...theCase, status: "stale", stale_reason: staleReason });
}

/** done / total as a whole percentage, where done is robust or fixed; 0 with no cases. */
export function coveragePctOf(cases) {
  if (cases.length === 0) return 0;
  return Math.round((cases.filter((theCase) => DONE_STATUSES.includes(theCase.status)).length / cases.length) * 100);
}

/** A finding still open on the case: a hole, or a stale case that was one. */
export const hasOpenFinding = (theCase) => Boolean(theCase.finding_id) && theCase.status !== "fixed";
