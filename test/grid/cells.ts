import type { DoorContract } from "@zaisma/core";

/**
 * The contract test grid (docs/DOORS.md): every door tried by every kind of caller, each cell's verdict from the door's
 * own contract. Here, the part that runs anywhere: who the callers are, what a contract expects of each, and how an
 * answer is judged. A cell never fails its test: results go to a file (test/grid/reporter.ts), and
 * scripts/contract-grid.mjs says which of them a change adds, so a check's log never shows one it didn't.
 */

export const CALLER_KINDS = ["owner", "another_account", "stranger", "banned_developer", "banned_account", "weaker_key", "another_games_key"] as const;
/** The owner's account, or their key; another account's; no credential at all; the owner banned, in each scope; the owner's key with less access, or for another of their games. */
export type CallerKind = (typeof CALLER_KINDS)[number];

/** kept: as the contract says. broken: the door was proven wrong for this caller. not_proven: the owner's own call didn't go through, or the grid couldn't try it. */
export type CellVerdict = "kept" | "broken" | "not_proven";

export interface GridCell {
  door_id: string;
  caller_kind: CallerKind;
  cell_verdict: CellVerdict;
  /** What went wrong, in general terms; null when kept. Never a value from the answer. */
  problem_line: string | null;
}

export type ExpectedAnswer =
  /** The door does its work. */
  | "goes_through"
  /** What the door answers with no session. */
  | "signed_out_answer"
  /** A banned developer, turned away to the dashboard. */
  | "sent_to_dashboard"
  /** A refusal of any kind: 4xx, or off to sign in. */
  | "refused"
  /** The same as naming something that isn't there. */
  | "like_nothing_there"
  /** Whatever the door does for this caller's own account: nothing of the owner's changes or shows. */
  | "own_things_only";

/** The parts of a site door's row (SiteDoor, apps/site/src/doors.ts) a verdict depends on. */
export interface SiteDoorFacts {
  contract: DoorContract;
  isClosedToBannedDeveloper?: true;
  isOpenToBannedDeveloper?: true;
  whenSignedOut?: { kind: string; httpStatus?: number };
}

/** What a door's contract expects of a caller. isOwnedInPath: the path names something of the owner's by what the door must hold to its owner. */
export function expectedAtSiteDoor(door: SiteDoorFacts, callerKind: CallerKind, isOwnedInPath: boolean): ExpectedAnswer {
  if (callerKind === "owner") return "goes_through";
  const { whoMayCall } = door.contract;
  // A key is the API's and the MCP's: on any other door it proves nothing, so its holder is a stranger.
  const isStranger = callerKind === "stranger" || callerKind === "weaker_key" || callerKind === "another_games_key";
  switch (whoMayCall) {
    case "admin":
      return "refused";
    case "signed_in":
      if (isStranger || callerKind === "banned_account") return "signed_out_answer";
      if (callerKind === "banned_developer") return door.isClosedToBannedDeveloper ? "sent_to_dashboard" : "goes_through";
      return "own_things_only";
    case "developer":
      if (isStranger || callerKind === "banned_account") return "signed_out_answer";
      if (callerKind === "banned_developer") return door.isOpenToBannedDeveloper ? "goes_through" : "sent_to_dashboard";
      return isOwnedInPath ? "like_nothing_there" : "own_things_only";
    case "anyone":
      return "own_things_only";
    default:
      // Proven by a function, from what's on the request: anyone without the proof is refused.
      return "refused";
  }
}

/** What came back from a call, and what it did. */
export interface CallAnswer {
  http_status: number;
  /** Where a redirect goes, or null. */
  location: string | null;
  /** Whether anything of the owner's changed. */
  is_owners_changed: boolean;
  /** Whether the answer holds a value private to the owner that the caller didn't send. */
  is_private_value_shown: boolean;
}

const isToSignIn = (location: string | null) => location !== null && /^\/(signin|join)\b/.test(location);
const isRefusal = ({ http_status, location }: CallAnswer) => (http_status >= 400 && http_status < 500) || isToSignIn(location);

/** Why an answer isn't what's expected; null when it is. nothingThere: the same caller's answer for something that doesn't exist. */
export function problemWithAnswer(expected: ExpectedAnswer, door: Pick<SiteDoorFacts, "whenSignedOut"> | null, answer: CallAnswer, nothingThere: Pick<CallAnswer, "http_status" | "location"> | null = null): string | null {
  if (answer.http_status >= 500) return `Answered ${answer.http_status}: the door's own code failed.`;
  if (expected === "goes_through") {
    if (answer.http_status >= 400) return `Answered ${answer.http_status}, where it should go through.`;
    return isToSignIn(answer.location) ? "Sent to sign in, where it should go through." : null;
  }
  if (answer.is_owners_changed) return "Changed something of the owner's.";
  if (answer.is_private_value_shown) return "Showed a value private to the owner.";
  switch (expected) {
    case "own_things_only":
      return null;
    case "refused":
      return isRefusal(answer) ? null : `Answered ${answer.http_status}, where it should refuse.`;
    case "sent_to_dashboard":
      return answer.location === "/dashboard" ? null : `Answered ${answer.http_status}, where a banned developer goes to the dashboard.`;
    case "like_nothing_there":
      if (!nothingThere) return "Nothing to compare with.";
      return answer.http_status === nothingThere.http_status && answer.location === nothingThere.location ? null : `Answered ${answer.http_status}, not as for something that isn't there (${nothingThere.http_status}).`;
    case "signed_out_answer": {
      const whenSignedOut = door?.whenSignedOut;
      if (whenSignedOut?.kind === "status") return answer.http_status === whenSignedOut.httpStatus ? null : `Answered ${answer.http_status}, not its signed-out ${whenSignedOut.httpStatus}.`;
      return isRefusal(answer) || (whenSignedOut?.kind === "profile" && answer.location?.startsWith("/@")) ? null : `Answered ${answer.http_status}, where signed out it should refuse.`;
    }
  }
}

/** A cell, from why its answer isn't right. The owner's own call failing proves nothing about anyone else, so it's not a hole. */
export const cellOf = (doorId: string, callerKind: CallerKind, problemLine: string | null): GridCell => ({
  door_id: doorId,
  caller_kind: callerKind,
  cell_verdict: problemLine === null ? "kept" : callerKind === "owner" ? "not_proven" : "broken",
  problem_line: problemLine,
});

declare module "vitest" {
  interface TaskMeta {
    grid_cells?: GridCell[];
  }
}
