import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { compareGridResults, comparisonLines } from "../../scripts/contract-grid.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { collectDoors } from "../../scripts/security-map/doors.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { loadSiteModule } from "../../scripts/security-map/load-site.mjs";
import { CALLER_KINDS, cellOf, expectedAtSiteDoor, problemWithAnswer, type CallAnswer, type GridCell } from "../grid/cells.ts";
import { CHANGES_NOTHING, COVERED_ELSEWHERE, MAY_TOUCH_OWNER, OWNER_NOT_PROVEN, OWNER_SETUP_ROUTES, PAGE_SAMPLES } from "../grid/samples.ts";

/**
 * The contract test grid's own working (docs/DOORS.md): what it expects of a door, what a comparison lets out, and that every door
 * can be tried. The cells themselves run only under scripts/contract-grid.mjs, so no check's log shows a failure a change didn't add.
 */

const ROOT = join(import.meta.dirname, "../..");
const kept = (door: string, caller: GridCell["caller_kind"] = "stranger"): GridCell => cellOf(door, caller, null);
const broken = (door: string, caller: GridCell["caller_kind"] = "stranger"): GridCell => cellOf(door, caller, "Answered 200, where it should refuse.");
const results = (...cells: GridCell[]) => ({ cells, doors_not_tried: [] as string[] });
const answer = (given: Partial<CallAnswer>): CallAnswer => ({ http_status: 200, location: null, is_owners_changed: false, is_private_value_shown: false, ...given });

describe("What a comparison lets out", () => {
  it("names only what the change adds", () => {
    const comparison = compareGridResults({ headResults: results(broken("page:GET /old"), broken("page:GET /new")), baseResults: results(broken("page:GET /old"), kept("page:GET /new")), isGridChanged: false });
    expect(comparison.outcome).toBe("new_failures");
    expect(comparison.new_cells.map((cell: GridCell) => cell.door_id)).toEqual(["page:GET /new"]);
    const lines = comparisonLines(comparison, "abc").join("\n");
    expect(lines).toContain("page:GET /new");
    expect(lines).not.toContain("page:GET /old");
  });

  it("says nothing of a failure that's on the base too", () => {
    const comparison = compareGridResults({ headResults: results(broken("page:GET /old")), baseResults: results(broken("page:GET /old")), isGridChanged: false });
    expect(comparison.outcome).toBe("nothing_new");
    expect(comparisonLines(comparison, "abc")).toEqual(["Contract grid: this change adds nothing."]);
  });

  it("counts a failure that comes back after a fix as new", () => {
    expect(compareGridResults({ headResults: results(broken("page:GET /fixed")), baseResults: results(kept("page:GET /fixed")), isGridChanged: false }).outcome).toBe("new_failures");
  });

  it("names no cell when the grid itself changed, since an old failure may be tried for the first time, and passes", () => {
    const comparison = compareGridResults({ headResults: results(broken("page:GET /old", "banned_account")), baseResults: results(), isGridChanged: true });
    expect(comparison.outcome).toBe("count_only_passes");
    expect(comparisonLines(comparison, "abc").join("\n")).not.toContain("/old");
  });

  it("names no cell when a failing door is gone, since an old failure may be there under its new name, and fails", () => {
    const comparison = compareGridResults({ headResults: results(broken("page:GET /new-name")), baseResults: results(broken("page:GET /old-name")), isGridChanged: false });
    expect(comparison.outcome).toBe("count_only_fails");
    const lines = comparisonLines(comparison, "abc").join("\n");
    expect(lines).not.toContain("new-name");
    expect(lines).not.toContain("old-name");
  });

  it("counts a door the grid couldn't try", () => {
    const comparison = compareGridResults({ headResults: { cells: [], doors_not_tried: ["page:GET /new"] }, baseResults: results(), isGridChanged: false });
    expect(comparison.outcome).toBe("new_failures");
    expect(comparison.new_doors_not_tried).toEqual(["page:GET /new"]);
  });

  it("prints nothing in the script's own runs but through the comparison", () => {
    const script = readFileSync(join(ROOT, "scripts/contract-grid.mjs"), "utf8");
    expect(script.match(/stdio: "ignore"/g)!.length).toBeGreaterThanOrEqual(2);
    expect(script).not.toMatch(/stdio: "inherit"/);
  });
});

describe("What a contract expects", () => {
  const signedIn = { contract: { whoMayCall: "signed_in", reaches: "account", trusts: ["session"] } } as const;
  const developer = { contract: { whoMayCall: "developer", reaches: "game", trusts: ["session"] } } as const;

  it("lets the owner through every door", () => {
    for (const whoMayCall of ["anyone", "signed_in", "developer", "admin", "link_holder"] as const) expect(expectedAtSiteDoor({ contract: { whoMayCall, reaches: "account", trusts: [] } as never }, "owner", true)).toBe("goes_through");
  });

  it("treats a key on a page as a stranger, since a key proves nothing there", () => {
    for (const callerKind of ["stranger", "weaker_key", "another_games_key"] as const) {
      expect(expectedAtSiteDoor(signedIn, callerKind, false)).toBe("signed_out_answer");
      expect(expectedAtSiteDoor(developer, callerKind, true)).toBe("signed_out_answer");
    }
  });

  it("holds another account to nothing there on what names the owner's, and to their own otherwise", () => {
    expect(expectedAtSiteDoor(developer, "another_account", true)).toBe("like_nothing_there");
    expect(expectedAtSiteDoor(developer, "another_account", false)).toBe("own_things_only");
    expect(expectedAtSiteDoor(signedIn, "another_account", false)).toBe("own_things_only");
  });

  it("keeps a banned developer to what their row says, and a closed account signed out", () => {
    expect(expectedAtSiteDoor(developer, "banned_developer", true)).toBe("sent_to_dashboard");
    expect(expectedAtSiteDoor({ ...developer, isOpenToBannedDeveloper: true }, "banned_developer", true)).toBe("goes_through");
    expect(expectedAtSiteDoor(signedIn, "banned_developer", false)).toBe("goes_through");
    expect(expectedAtSiteDoor({ ...signedIn, isClosedToBannedDeveloper: true }, "banned_developer", false)).toBe("sent_to_dashboard");
    expect(expectedAtSiteDoor(signedIn, "banned_account", false)).toBe("signed_out_answer");
  });

  it("refuses everyone but Zaisma's own people at an admin door, and anyone without the proof at a proven one", () => {
    for (const callerKind of CALLER_KINDS.filter((kind) => kind !== "owner")) {
      expect(expectedAtSiteDoor({ contract: { whoMayCall: "admin", reaches: "any_game", trusts: [] } }, callerKind, false)).toBe("refused");
      expect(expectedAtSiteDoor({ contract: { whoMayCall: "link_holder", reaches: "game", trusts: [] } as never }, callerKind, false)).toBe("refused");
    }
  });

  it("finds what's wrong with an answer", () => {
    expect(problemWithAnswer("refused", null, answer({ http_status: 200 }))).toContain("should refuse");
    expect(problemWithAnswer("refused", null, answer({ http_status: 403 }))).toBeNull();
    expect(problemWithAnswer("refused", null, answer({ http_status: 303, location: "/signin?next=/x" }))).toBeNull();
    expect(problemWithAnswer("refused", null, answer({ http_status: 403, is_owners_changed: true }))).toContain("Changed");
    expect(problemWithAnswer("own_things_only", null, answer({ is_private_value_shown: true }))).toContain("private");
    expect(problemWithAnswer("goes_through", null, answer({ http_status: 404 }))).toContain("should go through");
    expect(problemWithAnswer("own_things_only", null, answer({ http_status: 500 }))).toContain("500");
    expect(problemWithAnswer("like_nothing_there", null, answer({ http_status: 403 }), { http_status: 404, location: null })).toContain("isn't there");
    expect(problemWithAnswer("like_nothing_there", null, answer({ http_status: 404 }), { http_status: 404, location: null })).toBeNull();
    expect(problemWithAnswer("signed_out_answer", { whenSignedOut: { kind: "status", httpStatus: 401 } }, answer({ http_status: 403 }))).toContain("401");
    expect(problemWithAnswer("sent_to_dashboard", null, answer({ http_status: 303, location: "/dashboard" }))).toBeNull();
  });

  it("makes a failed owner's call not proven, never a hole, and another's broken", () => {
    expect(cellOf("page:GET /x", "owner", "No.").cell_verdict).toBe("not_proven");
    expect(cellOf("page:GET /x", "stranger", "No.").cell_verdict).toBe("broken");
    expect(cellOf("page:GET /x", "stranger", null).cell_verdict).toBe("kept");
  });
});

describe("Every door can be tried", () => {
  let site: any;
  let rowNames: string[];
  beforeAll(async () => {
    site = await loadSiteModule(ROOT);
    rowNames = site.SITE_DOORS.flatMap((door: { methods: string[] | "any"; path: string }) => (door.methods === "any" ? ["POST"] : door.methods).map((method) => `${method} ${door.path}`));
  });

  it("gives every door that writes a sample, or says where else it's tried", () => {
    const isAdminRow = (name: string) => site.SITE_DOORS.some((door: { path: string; contract: { whoMayCall: string } }) => name.endsWith(` ${door.path}`) && door.contract.whoMayCall === "admin");
    const missing = rowNames.filter((name) => !name.startsWith("GET ") && !name.startsWith("OPTIONS ") && !(name in PAGE_SAMPLES) && !(name in OWNER_NOT_PROVEN) && !(name in COVERED_ELSEWHERE) && !isAdminRow(name) && !isOpenRow(name));
    expect(missing, "Add a sample to PAGE_SAMPLES (test/grid/samples.ts), or a line to OWNER_NOT_PROVEN saying where it's tried").toEqual([]);

    function isOpenRow(name: string) {
      return site.SITE_DOORS.some((door: { path: string; contract: { whoMayCall: string } }) => name.endsWith(` ${door.path}`) && door.contract.whoMayCall === "anyone");
    }
  });

  it("names only rows that exist, in each of its lists", () => {
    const named = [PAGE_SAMPLES, OWNER_NOT_PROVEN, CHANGES_NOTHING, MAY_TOUCH_OWNER, OWNER_SETUP_ROUTES, COVERED_ELSEWHERE].flatMap((list) => Object.keys(list));
    expect(named.filter((name) => !rowNames.includes(name))).toEqual([]);
  });

  it("names a test that exists wherever it says one tries a door", () => {
    const cited = Object.values(OWNER_NOT_PROVEN).flatMap((why) => [...why.matchAll(/test\/[a-z-]+\/[a-z-]+\.test\.ts/g)].map((match) => match[0]));
    expect(cited.length).toBeGreaterThan(10);
    expect(cited.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
  });

  it("tries every door on the security map but a stored value and a token, which are tried through the doors that use them", async () => {
    const doors = await collectDoors(ROOT, site);
    const tried = new Set([
      ...site.SITE_DOORS.flatMap((door: unknown) => site.siteDoorIds(door)),
      ...site.API_ROUTES.map((route: { method: string; path: string }) => `api:${route.method} ${route.path}`),
      ...site.TOOLS.filter((tool: { replacedBy?: string }) => !tool.replacedBy).map((tool: { name: string }) => `mcp:${tool.name}`),
      ...site.ADMIN_TOOLS.map((tool: { name: string }) => `admin:${tool.name}`),
      ...site.ROOM_ADDRESS_DOORS.map((door: { path: string }) => `rooms:${door.path}`),
      ...Object.keys(site.ROOM_MESSAGE_DOORS).map((type) => `room-message:${type}`),
      ...["game-file:--preview", "game-file:--tester", "game-file:/", "game-file:/<file>"],
      ...Object.keys(site.GAME_FILE_DOORS).filter((name) => name.startsWith("_zaisma/")).map((name) => `game-file:${name}`),
    ]);
    const untried = doors.filter((door: { door_kind: string; door_id: string }) => door.door_kind !== "stored_value" && door.door_kind !== "token_or_session" && !tried.has(door.door_id)).map((door: { door_id: string }) => door.door_id);
    expect(untried).toEqual([]);
  });

  it("names doors the grid tries on every stored value", () => {
    expect(site.STORED_VALUES.length).toBeGreaterThan(50);
    const named = site.STORED_VALUES.flatMap((entry: { saved_by_door_ids: string[]; shown_on_door_ids: string[] }) => [...entry.saved_by_door_ids, ...entry.shown_on_door_ids]);
    expect(named.filter((doorId: string) => !/^(page|api|mcp|admin|rooms|room-message|game-file|token):/.test(doorId))).toEqual([]);
  });

  it("keeps the grid's files out of every other run", () => {
    const config = readFileSync(join(ROOT, "vitest.config.ts"), "utf8");
    expect(config).toContain("process.env.ZAISMA_CONTRACT_GRID");
    expect(config).toContain('.grid.ts');
  });
});
