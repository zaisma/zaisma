import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { anchorHashes, extractSymbol, hashSymbol } from "../../scripts/security-map/anchors.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { adminDoors, apiDoors, collectDoors, mcpDoors } from "../../scripts/security-map/doors.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { exportMapDir, exportPublic, historyIndexOf, publicExportProblems, checkMapDirExport } from "../../scripts/security-map/export-public.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { chains, pickFrontier, RECHECK_CASE_CAP, recheckSample } from "../../scripts/security-map/frontier.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { CHECKLISTS, generateMap, mergeDoors, readMap, writeMap } from "../../scripts/security-map/generate.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { loadSiteModule } from "../../scripts/security-map/load-site.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { canSetRobust, caseStatusProblems, DOOR_KINDS, SECTOR_IDS, SECTORS, unexploredCase, withVerdict } from "../../scripts/security-map/schema.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { SEED_RULES, seedRobust } from "../../scripts/security-map/seed-robust.mjs";

/**
 * The security map (docs/DECISIONS.md, "Zaisma's own AI looks for holes every night."; the
 * security-map skill): doors generated from the code, verdicts that go stale when that code changes,
 * day-one robust seeding from the tests, the night's frontier, and a public export that hides holes.
 */

const ROOT = join(import.meta.dirname, "../..");
const NOW = "2026-10-18T03:00:00.000Z";
const LATER = "2026-10-19T03:00:00.000Z";

type Anchor = { anchor_id: string; source_path: string; symbol_name: string; source_hash_sha256?: string | null };
type Evidence = { kind: string; ref: string; note: string };
type Case = { case_id: string; case_name: string; status: string; severity_tier: string | null; evidence: Evidence | null; finding_id: string | null; verdict_at: string | null; verdict_anchor_hashes: Record<string, string | null> | null; stale_reason: string | null };
type Door = { door_id: string; door_name: string; door_kind: string; sector_id: string; source_path: string; anchors: Anchor[]; gives: string[]; trusts: string[]; covered_by_door_id: string | null; door_removed_at?: string | null; cases: Case[] };
type Sector = { sector_id: string; sector_name: string; attacker_goal: string; doors: Door[] };
type Site = { API_ROUTES: { method: string; path: string }[]; TOOLS: { name: string }[]; ADMIN_TOOLS: { name: string }[] };
type FrontierItem = { bucket: string; sector_id: string; door_id: string; case_id: string; case_ref: string };

let workDir = "";
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "security-map-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const emptyMap = (): Sector[] => SECTORS.map((sector: Omit<Sector, "doors">) => ({ ...sector, doors: [] }));
const caseOf = (door: Door, caseId: string) => door.cases.find((theCase) => theCase.case_id === caseId)!;
const doorIn = (map: Sector[], doorId: string) => map.flatMap((sector) => sector.doors).find((door) => door.door_id === doorId)!;

/** A door with every case of its kind's checklist unexplored, and fixed anchor hashes. */
function fixtureDoor(doorId: string, sectorId: string, kind = "api_call", extra: Partial<Door> = {}): Door {
  return {
    door_id: doorId,
    door_name: doorId,
    door_kind: kind,
    sector_id: sectorId,
    source_path: "src/fixture.ts",
    anchors: [{ anchor_id: "src/fixture.ts:guard", source_path: "src/fixture.ts", symbol_name: "guard", source_hash_sha256: "hash-a" }],
    gives: [],
    trusts: [],
    covered_by_door_id: null,
    door_removed_at: null,
    cases: CHECKLISTS[kind].map(unexploredCase),
    ...extra,
  };
}

const probe = (note: string): Evidence => ({ kind: "probe", ref: `probes/${note}.md`, note });
const robust = (theCase: Case, note = "checked"): Case => withVerdict(theCase, { status: "robust", evidence: probe(note), verdict_at: NOW, verdict_anchor_hashes: { "src/fixture.ts:guard": "hash-a" } });

describe("doors from the real code", () => {
  let site: Site;
  let doors: Door[];
  beforeAll(async () => {
    site = await loadSiteModule(ROOT);
    doors = await collectDoors(ROOT, site);
  }, 60_000);

  it("has one API door per API_ROUTES entry, as many as developer.ts declares", () => {
    const declaredCount = readFileSync(join(ROOT, "apps/site/src/developer.ts"), "utf8").match(/\bcall\(\{/g)!.length;
    const api = apiDoors(site);
    expect(api.length).toBe(site.API_ROUTES.length);
    expect(api.length).toBe(declaredCount);
    expect(new Set(api.map((door: Door) => door.door_id)).size).toBe(api.length);
  });

  it("has one MCP door per tool, each covered by a real API door", async () => {
    const api = apiDoors(site);
    const mcp = await mcpDoors(site, api);
    expect(mcp.length).toBe(site.TOOLS.filter((tool: { name: string; replacedBy?: string }) => !tool.replacedBy).length);
    const apiIds = new Set(api.map((door: Door) => door.door_id));
    for (const door of mcp) expect(apiIds.has(door.covered_by_door_id), `${door.door_id} is covered by ${door.covered_by_door_id}`).toBe(true);
  });

  it("has one admin door per admin tool", () => {
    expect(adminDoors(site).length).toBe(site.ADMIN_TOOLS.length);
  });

  it("gives every door a known sector and kind, a unique id, and anchors that are all in the code", () => {
    expect(new Set(doors.map((door) => door.door_id)).size).toBe(doors.length);
    for (const door of doors) {
      expect(SECTOR_IDS, door.door_id).toContain(door.sector_id);
      expect(DOOR_KINDS, door.door_id).toContain(door.door_kind);
      expect(door.anchors.length, door.door_id).toBeGreaterThan(0);
    }
    const sourceByPath = new Map();
    const missing = doors.flatMap((door) => Object.entries(anchorHashes(ROOT, door.anchors, sourceByPath) as Record<string, string | null>).filter(([, hash]) => hash === null).map(([anchorId]) => `${door.door_id}: ${anchorId}`));
    expect(missing, "These anchors aren't in the code: point the door at where the code went (scripts/security-map/doors.mjs).").toEqual([]);
  });

  it("finds every kind of door", () => {
    expect([...new Set(doors.map((door) => door.door_kind))].sort()).toEqual([...DOOR_KINDS].sort());
  });

  it("seeds exactly what the tests prove, never over a hole, and the same the second time", () => {
    const { map } = mergeDoors({ map: emptyMap(), doors, hashesOf: (door: Door) => anchorHashes(ROOT, door.anchors), now: NOW });
    const someApiDoor = map.flatMap((sector: Sector) => sector.doors).find((door: Door) => door.door_kind === "api_call")!;
    const holeIndex = someApiDoor.cases.findIndex((theCase: Case) => theCase.case_id === "other-account-id");
    someApiDoor.cases[holeIndex] = withVerdict(someApiDoor.cases[holeIndex], { status: "hole", severity_tier: "urgent", finding_id: "fnd_seed", verdict_at: NOW, verdict_anchor_hashes: {} });

    const seeded = seedRobust(map, { repoRoot: ROOT, now: NOW });
    const allSeeded = seeded.map.flatMap((sector: Sector) => sector.doors);
    const accessCases = SEED_RULES[0].caseIds;
    for (const door of allSeeded.filter((door: Door) => door.door_kind === "api_call")) {
      for (const theCase of door.cases) {
        if (door.door_id === someApiDoor.door_id && theCase.case_id === "other-account-id") {
          expect(theCase.status).toBe("hole");
          continue;
        }
        expect(theCase.status, `${door.door_id}#${theCase.case_id}`).toBe(accessCases.includes(theCase.case_id) ? "robust" : "unexplored");
        if (theCase.status === "robust") {
          expect(theCase.evidence!.ref).toBe("test/site/access-checks.test.ts");
          expect(theCase.verdict_anchor_hashes).toEqual(Object.fromEntries(door.anchors.map((anchor: Anchor) => [anchor.anchor_id, anchor.source_hash_sha256])));
        }
      }
    }
    for (const door of allSeeded.filter((door: Door) => door.door_kind === "mcp_tool")) expect(caseOf(door, "tool-maps-to-declared-route").evidence!.ref).toBe("test/site/api-mcp-parity.test.ts");
    expect(caseOf(doorIn(seeded.map, "page:POST /signin"), "cross-site-post").status).toBe("robust");
    expect(caseOf(doorIn(seeded.map, "token:session"), "forged").status).toBe("robust");
    expect(caseOf(doorIn(seeded.map, "game-file:--tester"), "tester-link-after-off").status).toBe("robust");
    expect(caseOf(doorIn(seeded.map, "game-file:--tester"), "path-traversal").status).toBe("unexplored");

    const again = seedRobust(seeded.map, { repoRoot: ROOT, now: LATER });
    expect(again.seeded_case_refs).toEqual([]);
    expect(again.map).toEqual(seeded.map);
  });

  it("seeds nothing from a rule whose file isn't in the repo yet", () => {
    const { map } = mergeDoors({ map: emptyMap(), doors, hashesOf: (door: Door) => anchorHashes(ROOT, door.anchors), now: NOW });
    const missingFileRule = { ...SEED_RULES.find((rule: { requiresFile?: boolean }) => rule.requiresFile), evidence: { kind: "ship_check", ref: "scripts/not-here-yet.mjs", note: "a check from a slice that hasn't merged" } };
    expect(seedRobust(map, { repoRoot: ROOT, now: NOW, rules: [missingFileRule] }).seeded_case_refs).toEqual([]);
  });
});

describe("generating into a map directory", () => {
  const SOURCE = `export function guard(request: Request): boolean {\n  return request.headers.get("origin") === "https://zaisma.com";\n}\n\nexport const other = 1;\n`;

  function fixtureRepo(source = SOURCE) {
    mkdirSync(join(workDir, "repo/src"), { recursive: true });
    writeFileSync(join(workDir, "repo/src/fixture.ts"), source);
  }
  const codeDoors = (): Door[] => [
    { ...fixtureDoor("api:GET /b", "accounts"), cases: [] },
    { ...fixtureDoor("api:GET /a", "player-data"), cases: [] },
  ];

  it("writes stable files, and a re-run changes nothing", async () => {
    fixtureRepo();
    const repoRoot = join(workDir, "repo");
    const mapDir = join(workDir, "map");
    const first = await generateMap({ repoRoot, mapDir, doors: codeDoors(), now: NOW });
    expect(first.new_door_ids).toEqual(["api:GET /b", "api:GET /a"]);
    const files = SECTORS.map((sector: Sector) => readFileSync(join(mapDir, "map", `${sector.sector_id}.json`), "utf8"));
    const second = await generateMap({ repoRoot, mapDir, doors: codeDoors(), now: LATER });
    expect(second).toEqual({ new_door_ids: [], removed_door_ids: [], stale_case_refs: [], missing_anchor_ids: [] });
    expect(SECTORS.map((sector: Sector) => readFileSync(join(mapDir, "map", `${sector.sector_id}.json`), "utf8"))).toEqual(files);
    const door = doorIn(readMap(mapDir), "api:GET /a");
    expect(door.cases.map((theCase) => theCase.case_id)).toEqual(CHECKLISTS.api_call.map((item: { case_id: string }) => item.case_id));
    expect(door.anchors[0]!.source_hash_sha256).toBe(hashSymbol(SOURCE, "guard"));
  });

  it("makes a verdict stale when the code it relied on changes, and keeps one whose code is the same", async () => {
    fixtureRepo();
    const repoRoot = join(workDir, "repo");
    const mapDir = join(workDir, "map");
    await generateMap({ repoRoot, mapDir, doors: codeDoors(), now: NOW });
    const map = readMap(mapDir);
    const hashes = { "src/fixture.ts:guard": hashSymbol(SOURCE, "guard") };
    for (const door of map.flatMap((sector: Sector) => sector.doors)) door.cases[0] = withVerdict(door.cases[0], { status: "robust", evidence: probe("origin checked"), verdict_at: NOW, verdict_anchor_hashes: hashes });
    writeMap(mapDir, map);

    // A reformat and a change elsewhere in the file: still identical.
    fixtureRepo(SOURCE.replace("boolean {", "boolean   {").replace("other = 1", "other = 2"));
    expect((await generateMap({ repoRoot, mapDir, doors: codeDoors(), now: LATER })).stale_case_refs).toEqual([]);
    expect(caseOf(doorIn(readMap(mapDir), "api:GET /a"), "other-account-id").status).toBe("robust");

    // A real change to the guard: stale, with why.
    fixtureRepo(SOURCE.replace("https://zaisma.com", "https://zaisma.com.evil"));
    const summary = await generateMap({ repoRoot, mapDir, doors: codeDoors(), now: LATER });
    expect(summary.stale_case_refs.sort()).toEqual(["api:GET /a#other-account-id", "api:GET /b#other-account-id"]);
    const stale = caseOf(doorIn(readMap(mapDir), "api:GET /a"), "other-account-id");
    expect(stale.status).toBe("stale");
    expect(stale.stale_reason).toContain("src/fixture.ts:guard changed");
    expect(stale.evidence!.note).toBe("origin checked");
  });

  it("makes a verdict stale, loudly, when its anchor is gone; and keeps a door gone from the code", async () => {
    fixtureRepo();
    const repoRoot = join(workDir, "repo");
    const mapDir = join(workDir, "map");
    await generateMap({ repoRoot, mapDir, doors: codeDoors(), now: NOW });
    const map = readMap(mapDir);
    const door = doorIn(map, "api:GET /a");
    door.cases[0] = withVerdict(door.cases[0], { status: "robust", evidence: probe("x"), verdict_at: NOW, verdict_anchor_hashes: { "src/fixture.ts:guard": hashSymbol(SOURCE, "guard") } });
    writeMap(mapDir, map);
    fixtureRepo("export const other = 1;\n");
    const warnings: string[] = [];
    const summary = await generateMap({ repoRoot, mapDir, doors: codeDoors(), now: LATER, warn: (text: string) => warnings.push(text) });
    expect(summary.missing_anchor_ids).toEqual(["src/fixture.ts:guard"]);
    expect(warnings.join("\n")).toContain("src/fixture.ts:guard");
    expect(caseOf(doorIn(readMap(mapDir), "api:GET /a"), "other-account-id").stale_reason).toContain("missing from the code");

    const gone = await generateMap({ repoRoot, mapDir, doors: codeDoors().slice(0, 1), now: LATER });
    expect(gone.removed_door_ids).toEqual(["api:GET /a"]);
    expect(doorIn(readMap(mapDir), "api:GET /a").door_removed_at).toBe(LATER);
  });
});

describe("the anchor hasher", () => {
  const SAMPLE = `const before = 1;
export async function checkThing(request: Request, given: { name: string }): Promise<{ ok: boolean } | null> {
  const pattern = /^\\/a\\{b\\}$/; // a } in a regular expression and a comment
  const text = \`a \${"}"} b\`;
  if (pattern.test(request.url)) return { ok: true };
  return null;
}
class Room {
  receive(playerId: string, text: string): string | null {
    switch (text) {
      case "kick":
        return "no";
    }
    return null;
  }
}
export default {
  async fetch() {
    return new Response("hi");
  },
};
`;

  it("finds functions, methods, consts and the default export, brackets in strings and patterns aside", () => {
    expect(extractSymbol(SAMPLE, "checkThing")).toMatch(/^export async function checkThing[\s\S]*return null;\n}$/);
    expect(extractSymbol(SAMPLE, "receive")).toMatch(/^ {2}receive\(playerId[\s\S]*return null;\n {2}}$/);
    expect(extractSymbol(SAMPLE, "before")).toBe("const before = 1;");
    expect(extractSymbol(SAMPLE, "default")).toMatch(/^export default \{[\s\S]*},\n}$/);
    expect(extractSymbol(SAMPLE, "nothing")).toBeNull();
  });

  it("is stable, ignores whitespace, changes with the body and is null for a missing symbol", () => {
    const hash = hashSymbol(SAMPLE, "checkThing");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSymbol(SAMPLE, "checkThing")).toBe(hash);
    expect(hashSymbol(SAMPLE.replace("  if (pattern", "\n\n      if (pattern"), "checkThing")).toBe(hash);
    expect(hashSymbol(SAMPLE.replace("return { ok: true }", "return { ok: false }"), "checkThing")).not.toBe(hash);
    expect(hashSymbol(SAMPLE, "missingThing")).toBeNull();
  });
});

describe("a case's status", () => {
  const base = unexploredCase({ case_id: "other-account-id", case_name: "Another account's ID" });
  const verdict = { verdict_at: NOW, verdict_anchor_hashes: { "src/fixture.ts:guard": "hash-a" } };

  it("passes a valid case of each status", () => {
    const valid = [
      base,
      { ...base, ...verdict, status: "robust", evidence: probe("x") },
      { ...base, ...verdict, status: "weak", evidence: probe("x"), severity_tier: "hardening" },
      { ...base, ...verdict, status: "hole", severity_tier: "urgent", finding_id: "fnd_x" },
      { ...base, ...verdict, status: "fixed", evidence: { kind: "test", ref: "test/site/x.test.ts", note: "guards it" }, finding_id: "fnd_x" },
      { ...base, ...verdict, status: "stale", evidence: probe("x"), stale_reason: "src/fixture.ts:guard changed since the verdict" },
    ];
    for (const theCase of valid) expect(caseStatusProblems(theCase), theCase.status).toEqual([]);
  });

  it("flags a robust case with no evidence, a hole with no tier, and a hole carrying evidence", () => {
    expect(caseStatusProblems({ ...base, ...verdict, status: "robust" }).join()).toContain("no evidence");
    expect(caseStatusProblems({ ...base, ...verdict, status: "hole", finding_id: "fnd_x" }).join()).toContain("severity_tier");
    expect(caseStatusProblems({ ...base, ...verdict, status: "hole", finding_id: "fnd_x", severity_tier: "urgent", evidence: probe("repro") }).join()).toContain("carrying evidence");
    expect(caseStatusProblems({ ...base, status: "robust", evidence: probe("x") }).join()).toContain("verdict_anchor_hashes");
  });

  it("can't be set robust without evidence", () => {
    expect(canSetRobust(base)).toBe(false);
    expect(canSetRobust({ ...base, evidence: probe("x") })).toBe(true);
    expect(() => withVerdict(base, { status: "robust", ...verdict })).toThrow(/evidence/);
  });
});

describe("the night's frontier", () => {
  function frontierMap(): Sector[] {
    const map = emptyMap();
    // Accounts: well covered. Rooms: nothing explored, so its unexplored cases come first.
    const accountsDoor = fixtureDoor("api:GET /accounts-door", "accounts");
    accountsDoor.cases = accountsDoor.cases.map((theCase, index) => (index < 12 ? robust(theCase, `case ${index}`) : theCase));
    accountsDoor.cases[12] = { ...robust(accountsDoor.cases[12]!), status: "stale", stale_reason: "src/fixture.ts:guard changed since the verdict" };
    map.find((sector) => sector.sector_id === "accounts")!.doors.push(accountsDoor);
    map.find((sector) => sector.sector_id === "rooms")!.doors.push(fixtureDoor("room-message:kick", "rooms", "room_message"));
    return map;
  }

  it("does stale first, then the recheck sample, then the least-covered sector's unexplored cases", () => {
    const frontier: FrontierItem[] = pickFrontier(frontierMap(), { date: "2026-10-18", budgetCaseCount: 40 });
    const buckets = frontier.map((item) => item.bucket);
    expect(buckets[0]).toBe("stale");
    expect(frontier[0]!.case_ref).toBe("api:GET /accounts-door#age-16-17");
    const firstUnexplored = buckets.indexOf("unexplored");
    expect(buckets.slice(1, firstUnexplored).every((bucket) => bucket === "recheck")).toBe(true);
    expect(buckets.slice(firstUnexplored).every((bucket) => bucket === "unexplored")).toBe(true);
    expect(frontier[firstUnexplored]!.sector_id).toBe("rooms");
  });

  it("rechecks only probe-backed robust cases, at most a quarter of the budget", () => {
    const map = emptyMap();
    const accounts = map.find((sector) => sector.sector_id === "accounts")!;
    for (let index = 0; index < 30; index += 1) {
      const door = fixtureDoor(`api:GET /door-${String(index).padStart(2, "0")}`, "accounts");
      door.cases = door.cases.map((theCase, caseIndex) =>
        caseIndex < 5 ? robust(theCase) : withVerdict(theCase, { status: "robust", evidence: { kind: "test", ref: "test/site/access-checks.test.ts", note: "proven by CI" }, verdict_at: NOW, verdict_anchor_hashes: {} }),
      );
      accounts.doors.push(door);
    }
    const frontier: FrontierItem[] = pickFrontier(map, { date: "2026-10-18", budgetCaseCount: 40 });
    const rechecks = frontier.filter((item) => item.bucket === "recheck");
    expect(rechecks).toHaveLength(RECHECK_CASE_CAP);
    for (const item of rechecks) expect(caseOf(doorIn(map, item.door_id), item.case_id).evidence!.kind).toBe("probe");
  });

  it("never goes over its budget", () => {
    expect(pickFrontier(frontierMap(), { date: "2026-10-18", budgetCaseCount: 3 })).toHaveLength(3);
  });

  it("rechecks about a tenth of robust cases, the same for a date and different across dates", () => {
    const refs = Array.from({ length: 200 }, (_, index) => `api:GET /door-${index}#other-account-id`);
    const today = recheckSample(refs, "2026-10-18");
    expect(today).toHaveLength(20);
    expect(recheckSample(refs, "2026-10-18")).toEqual(today);
    expect(recheckSample(refs, "2026-10-19")).not.toEqual(today);
  });
});

describe("chains", () => {
  it("crosses doors that give a thing with doors that trust it, minus the ones tried", () => {
    const map = emptyMap();
    const accounts = map.find((sector) => sector.sector_id === "accounts")!;
    accounts.doors.push(fixtureDoor("page:POST /account/keys", "accounts", "page_form", { gives: ["api_key"] }));
    accounts.doors.push(fixtureDoor("api:GET /games", "accounts", "api_call", { trusts: ["api_key"] }));
    accounts.doors.push(fixtureDoor("api:GET /access", "accounts", "api_call", { trusts: ["api_key"] }));
    const all = chains(map);
    expect(all).toEqual([
      { thing: "api_key", giver_door_id: "page:POST /account/keys", truster_door_id: "api:GET /access" },
      { thing: "api_key", giver_door_id: "page:POST /account/keys", truster_door_id: "api:GET /games" },
    ]);
    expect(chains(map, [all[0]])).toEqual([all[1]]);
  });
});

describe("the public export", () => {
  function mapWithHole(): Sector[] {
    const map = emptyMap();
    const player = map.find((sector) => sector.sector_id === "player-data")!;
    const secretDoor = fixtureDoor("api:GET /secret-door", "player-data");
    secretDoor.cases.push(withVerdict(unexploredCase({ case_id: "secret-case", case_name: "secret-case" }), { status: "hole", severity_tier: "urgent", finding_id: "fnd_x", verdict_at: NOW, verdict_anchor_hashes: {} }));
    secretDoor.cases[0] = robust(secretDoor.cases[0]!);
    const coveringTool = fixtureDoor("mcp:secret_tool", "player-data", "mcp_tool", { covered_by_door_id: "api:GET /secret-door" });
    const formerHoleDoor = fixtureDoor("api:GET /stale-hole-door", "player-data");
    formerHoleDoor.cases[0] = { ...formerHoleDoor.cases[0]!, status: "stale", severity_tier: "important", finding_id: "fnd_y", verdict_at: NOW, verdict_anchor_hashes: {}, stale_reason: "src/fixture.ts:guard changed since the verdict" };
    const openDoor = fixtureDoor("api:GET /open-door", "player-data");
    openDoor.cases[0] = robust(openDoor.cases[0]!, "the origin is checked");
    player.doors.push(secretDoor, coveringTool, formerHoleDoor, openDoor);
    return map;
  }

  it("never names a hole's door, case, finding or repro, and counts it at its sector only", () => {
    const mapDir = join(workDir, "map");
    mkdirSync(join(mapDir, "findings"), { recursive: true });
    writeFileSync(join(mapDir, "findings/2026-10-18-secret.md"), "repro: curl https://zaisma.com/api/dev/secret-door\n");
    writeMap(mapDir, mapWithHole());
    const exported = exportMapDir({ mapDir, now: NOW });
    const text = JSON.stringify(exported);
    for (const secret of ["secret-door", "secret-case", "fnd_x", "fnd_y", "secret_tool", "stale-hole-door", "repro: curl"]) expect(text, secret).not.toContain(secret);
    const player = exported.sectors.find((sector: { sector_id: string }) => sector.sector_id === "player-data");
    expect(player.hole_count_by_tier).toEqual({ urgent: 1, important: 1, hardening: 0 });
    expect(player.doors.map((door: { door_id: string }) => door.door_id)).toEqual(["api:GET /open-door"]);
    expect(player.doors[0].cases[0]).toEqual({ case_id: "other-account-id", case_name: "Another account's ID", status: "robust", severity_tier: null, last_checked_at: NOW, evidence: probe("the origin is checked"), stale_reason: null });
    expect(player.doors[0].cases[1].evidence).toBeNull();
    expect(checkMapDirExport({ mapDir })).toEqual([]);
  });

  it("catches an export that would leak", () => {
    const map = mapWithHole();
    const leaky = exportPublic(emptyMap(), { now: NOW });
    leaky.sectors[3].doors.push({ door_id: "api:GET /secret-door", door_name: "x", door_kind: "api_call", covered_by_door_id: null, door_removed_at: null, cases: [{ case_id: "secret-case", case_name: "x", status: "hole", severity_tier: "urgent", last_checked_at: NOW, evidence: null, finding_id: "fnd_x" }] });
    const problems = publicExportProblems(leaky, map).join("\n");
    expect(problems).toContain("api:GET /secret-door");
    expect(problems).toContain("fnd_x");
    expect(problems).toContain("shows a hole case");
    expect(problems).toContain("exports finding_id");
  });

  const holeCase = (caseId: string, tier = "urgent", findingId = "fnd_h") => withVerdict(unexploredCase({ case_id: caseId, case_name: caseId }), { status: "hole", severity_tier: tier, finding_id: findingId, verdict_at: NOW, verdict_anchor_hashes: {} });
  const exportWritten = (map: Sector[], date: string, now = NOW) => {
    const mapDir = join(workDir, "map");
    writeMap(mapDir, map);
    return { mapDir, exported: exportMapDir({ mapDir, now, date }) };
  };
  const playerDoors = (exported: { sectors: { sector_id: string; doors: { door_id: string }[] }[] }) => exported.sectors.find((sector) => sector.sector_id === "player-data")!.doors.map((door) => door.door_id);

  it("pins the export's shape: a format version, and each door's kind, cover and removal", () => {
    const map = emptyMap();
    map[0]!.doors.push(fixtureDoor("api:GET /plain", "accounts"), fixtureDoor("mcp:plain", "accounts", "mcp_tool", { covered_by_door_id: "api:GET /plain" }));
    const { exported } = exportWritten(map, "2026-10-18");
    expect(exported.export_format_version).toBe(1);
    expect(Object.keys(exported).sort()).toEqual(["export_format_version", "generated_at", "sectors", "since_last_night"]);
    expect(Object.keys(exported.sectors[0].doors[1]).sort()).toEqual(["cases", "covered_by_door_id", "door_id", "door_kind", "door_name", "door_removed_at"]);
    expect(exported.sectors[0].doors[1].covered_by_door_id).toBe("api:GET /plain");
    expect(exported.sectors[0].hole_count_by_tier_at_baseline).toBeNull();
  });

  it("hides a stale case that carries a finding, an MCP door over a hidden one, and a hole in a nested case, and never writes them to history", () => {
    const map = emptyMap();
    const player = map.find((sector) => sector.sector_id === "player-data")!;
    const staleHole = fixtureDoor("api:GET /ghost-stale", "player-data");
    staleHole.cases[0] = { ...staleHole.cases[0]!, status: "stale", severity_tier: "hardening", finding_id: "fnd_ghost_stale", verdict_at: NOW, verdict_anchor_hashes: {}, stale_reason: "ghost note" };
    const holeApi = fixtureDoor("api:GET /ghost-api", "player-data");
    holeApi.cases[0] = holeCase("ghost-case", "important", "fnd_ghost_api");
    const tool = fixtureDoor("mcp:ghost_tool", "player-data", "mcp_tool", { covered_by_door_id: "api:GET /ghost-api" });
    player.doors.push(staleHole, holeApi, tool, fixtureDoor("api:GET /visible", "player-data"));
    const { mapDir, exported } = exportWritten(map, "2026-10-18");
    const history = readFileSync(join(mapDir, "exports/history/2026-10-18.json"), "utf8");
    for (const secret of ["ghost-stale", "ghost-api", "ghost_tool", "ghost-case", "fnd_ghost", "ghost note"]) {
      expect(JSON.stringify(exported), secret).not.toContain(secret);
      expect(history, secret).not.toContain(secret);
    }
    expect(playerDoors(exported)).toEqual(["api:GET /visible"]);
    expect(exported.sectors.find((sector: { sector_id: string }) => sector.sector_id === "player-data").hole_count_by_tier).toEqual({ urgent: 0, important: 1, hardening: 1 });
  });

  it("hides a door whose hole sits in a nested case, and counts it", () => {
    // The stored map has no nested cases yet (orderedCase drops them), so this builds the map in memory.
    const map = emptyMap();
    const nested = fixtureDoor("api:GET /ghost-nested", "player-data");
    (nested.cases[0] as Case & { cases?: Case[] }).cases = [holeCase("ghost-inner", "urgent", "fnd_ghost_nested")];
    map.find((sector) => sector.sector_id === "player-data")!.doors.push(nested, fixtureDoor("api:GET /visible", "player-data"));
    const exported = exportPublic(map, { now: NOW });
    expect(playerDoors(exported)).toEqual(["api:GET /visible"]);
    expect(exported.sectors.find((sector: { sector_id: string }) => sector.sector_id === "player-data").hole_count_by_tier).toEqual({ urgent: 1, important: 0, hardening: 0 });
    for (const secret of ["ghost-nested", "ghost-inner", "fnd_ghost_nested"]) expect(JSON.stringify([exported, historyIndexOf(exported)]), secret).not.toContain(secret);
    expect(publicExportProblems(exported, map)).toEqual([]);
  });

  it("exports nested cases of a visible door, sanitized the same way", () => {
    const map = emptyMap();
    const door = fixtureDoor("api:GET /nests", "player-data");
    (door.cases[0] as Case & { cases?: Case[] }).cases = [{ ...unexploredCase({ case_id: "inner", case_name: "Inner" }), finding_id: null }];
    map.find((sector) => sector.sector_id === "player-data")!.doors.push(door);
    const exported = exportPublic(map, { now: NOW });
    expect(exported.sectors.find((sector: { sector_id: string }) => sector.sector_id === "player-data").doors[0].cases[0].cases).toEqual([{ case_id: "inner", case_name: "Inner", status: "unexplored", severity_tier: null, last_checked_at: null, evidence: null, stale_reason: null }]);
    expect(Object.keys(historyIndexOf(exported).case_status_by_door["api:GET /nests"]!)).toContain("other-account-id/inner");
  });

  it("compares with the day before: explored, stale, new doors, and a door that came back fixed isn't new", () => {
    const first = emptyMap();
    const player = first.find((sector) => sector.sector_id === "player-data")!;
    player.doors.push(fixtureDoor("api:GET /steady", "player-data"), fixtureDoor("api:GET /to-stale", "player-data"), fixtureDoor("api:GET /returning-hole", "player-data"));
    player.doors[2]!.cases[0] = holeCase("hole-then-fixed", "urgent", "fnd_back");
    const mapDir = join(workDir, "map");
    writeMap(mapDir, first);
    const empty = exportMapDir({ mapDir, now: NOW, date: "2026-10-17" });
    expect(empty.since_last_night).toEqual({ baseline_generated_at: null, explored_cases: [], stale_cases: [], new_doors: [] });

    const second = emptyMap();
    const next = second.find((sector) => sector.sector_id === "player-data")!;
    const steady = fixtureDoor("api:GET /steady", "player-data");
    steady.cases[0] = robust(steady.cases[0]!, "now proven");
    const toStale = fixtureDoor("api:GET /to-stale", "player-data");
    toStale.cases[0] = withVerdict(toStale.cases[0]!, { status: "robust", evidence: probe("was proven"), verdict_at: NOW, verdict_anchor_hashes: {} });
    const returning = fixtureDoor("api:GET /returning-hole", "player-data");
    returning.cases[0] = withVerdict(returning.cases[0]!, { status: "fixed", evidence: probe("guarded now"), finding_id: "fnd_back", verdict_at: NOW, verdict_anchor_hashes: {} });
    next.doors.push(steady, toStale, returning, fixtureDoor("api:GET /brand-new", "player-data"));
    writeMap(mapDir, second);
    const exported = exportMapDir({ mapDir, now: LATER, date: "2026-10-18" });
    const since = exported.since_last_night;
    expect(since.baseline_generated_at).toBe(NOW);
    expect(since.explored_cases.map((item: { door_id: string; case_id: string; status: string }) => `${item.door_id}#${item.case_id}:${item.status}`)).toEqual(["api:GET /returning-hole#other-account-id:fixed", "api:GET /steady#other-account-id:robust", "api:GET /to-stale#other-account-id:robust"]);
    expect(since.stale_cases).toEqual([]);
    expect(since.new_doors.map((item: { door_id: string }) => item.door_id)).toEqual(["api:GET /brand-new"]);
    expect(exported.sectors.find((sector: { sector_id: string }) => sector.sector_id === "player-data").hole_count_by_tier_at_baseline).toEqual({ urgent: 1, important: 0, hardening: 0 });

    const third = emptyMap();
    const last = third.find((sector) => sector.sector_id === "player-data")!;
    const gone = fixtureDoor("api:GET /to-stale", "player-data");
    gone.cases[0] = { ...toStale.cases[0]!, status: "stale", stale_reason: "src/fixture.ts:guard changed since the verdict" };
    last.doors.push(steady, gone, returning, fixtureDoor("api:GET /brand-new", "player-data"));
    writeMap(mapDir, third);
    const afterwards = exportMapDir({ mapDir, now: "2026-10-20T03:00:00.000Z", date: "2026-10-19" });
    expect(afterwards.since_last_night.stale_cases).toEqual([{ sector_id: "player-data", door_id: "api:GET /to-stale", case_id: "other-account-id", case_name: "Another account's ID", stale_reason: "src/fixture.ts:guard changed since the verdict" }]);
    expect(afterwards.since_last_night.explored_cases).toEqual([]);
  });

  it("keeps the same baseline when exporting again on the same date, and deletes history over 14 days old", () => {
    const mapDir = join(workDir, "map");
    writeMap(mapDir, emptyMap());
    const historyDir = join(mapDir, "exports/history");
    mkdirSync(historyDir, { recursive: true });
    for (const day of ["2026-10-01", "2026-10-03", "2026-10-04", "2026-10-17"]) writeFileSync(join(historyDir, `${day}.json`), JSON.stringify({ generated_at: `${day}T03:00:00.000Z`, case_status_by_door: {}, hole_count_by_tier_by_sector: {} }));
    const first = exportMapDir({ mapDir, now: NOW, date: "2026-10-18" });
    const again = exportMapDir({ mapDir, now: LATER, date: "2026-10-18" });
    expect(first.since_last_night.baseline_generated_at).toBe("2026-10-17T03:00:00.000Z");
    expect(again.since_last_night.baseline_generated_at).toBe("2026-10-17T03:00:00.000Z");
    expect(readdirSync(historyDir).sort()).toEqual(["2026-10-04.json", "2026-10-17.json", "2026-10-18.json"]);
    expect(existsSync(join(historyDir, "2026-10-01.json"))).toBe(false);
  });

  it("names each broken rule of an export on its own", () => {
    const clean = exportPublic(emptyMap(), { now: NOW });
    expect(publicExportProblems(clean)).toEqual([]);
    const broken = structuredClone(clean);
    const door = (doorId: string, cases: object[], extra: object = {}) => ({ door_id: doorId, door_name: doorId, door_kind: "api_call", covered_by_door_id: null, door_removed_at: null, cases, ...extra });
    const plain = { case_id: "c", case_name: "c", status: "unexplored", severity_tier: null, last_checked_at: null, evidence: null, stale_reason: null };
    broken.export_format_version = 2;
    broken.sectors[0].doors.push(door("api:dup", [{ ...plain, status: "hole" }]), door("api:dup", [{ ...plain, finding_id: "fnd_z" }]), door("api:evidence", [{ ...plain, evidence: { kind: "probe", ref: "x", note: "" } }]), door("mcp:dangling", [plain], { covered_by_door_id: "api:nowhere" }));
    const problems = publicExportProblems(broken).join("\n");
    for (const expected of ["export_format_version is 2", "shows a hole case", "exports finding_id", "exports evidence while unexplored", "is in the export twice", "api:nowhere, which isn't in the export"]) expect(problems).toContain(expected);
  });
});

describe("the checklists", () => {
  it("give every door kind its cases, each id once", () => {
    for (const kind of DOOR_KINDS) {
      const ids = (CHECKLISTS[kind] ?? []).map((item: { case_id: string }) => item.case_id);
      expect(ids.length, kind).toBeGreaterThan(0);
      expect(new Set(ids).size, kind).toBe(ids.length);
    }
    expect(Object.keys(CHECKLISTS).sort()).toEqual([...DOOR_KINDS].sort());
  });
});
