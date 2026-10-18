import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { buildPage, MAXIMUM_PAGE_BYTES } from "../../scripts/security-map/build-page.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { demoExport } from "../../scripts/security-map/page/demo-export.mjs";
import {
  buildGraph,
  buildHitGrid,
  displayStatusOf,
  expandEverythingUnder,
  fitView,
  hitTest,
  layoutGraph,
  MAX_VISIBLE_NODE_COUNT,
  NODE_RADIUS_BY_KIND,
  sanitizeExport,
  SECTOR_MIN_ARC_FRACTION,
  searchDoors,
  STATUS_ORDER,
  statusCountsOf,
  visibleNodeIds,
  // @ts-expect-error: a plain JavaScript script without types
} from "../../scripts/security-map/page/graph.mjs";

/**
 * The Security map page (the security-map skill's Page section): the export cleaner, the tree, the layout,
 * the pointer lookup and the built file. The drawing is checked in the browser pane; everything the drawing
 * decides lives in graph.mjs, so it's tested here without a DOM.
 */

const ROOT = join(import.meta.dirname, "../..");
const CLI = join(ROOT, "scripts/security-map/cli.mjs");

type Position = { x: number; y: number; angleRad: number; depth: number; radius: number };
type Node = { nodeId: string; nodeKind: string; childIds: string[]; isAlias: boolean; parentId: string | null; depth: number; source: Record<string, unknown> };
type Graph = { nodesById: Map<string, Node>; rootId: string; sectorIds: string[] };
type Layout = { positionsById: Map<string, Position>; ringRadii: number[]; bounds: { minX: number; minY: number; maxX: number; maxY: number } };
type CaseOf = { case_id: string; case_name: string; status: string; severity_tier: null; last_checked_at: null; evidence: null; stale_reason: null };

const caseOf = (caseId: string, status = "unexplored"): CaseOf => ({ case_id: caseId, case_name: caseId, status, severity_tier: null, last_checked_at: null, evidence: null, stale_reason: null });
const doorOf = (doorId: string, doorKind: string, cases: CaseOf[], extra: Record<string, unknown> = {}) => ({ door_id: doorId, door_name: doorId, door_kind: doorKind, covered_by_door_id: null, door_removed_at: null, cases, ...extra });
const sectorOf = (sectorId: string, doors: ReturnType<typeof doorOf>[]) => ({
  sector_id: sectorId,
  sector_name: sectorId,
  attacker_goal: "goal",
  coverage_pct: 0,
  door_count: doors.length,
  case_count: doors.reduce((sum, door) => sum + door.cases.length, 0),
  done_case_count: 0,
  hole_count_by_tier: { urgent: 0, important: 0, hardening: 0 },
  hole_count_by_tier_at_baseline: null,
  doors,
});
const exportOf = (sectors: ReturnType<typeof sectorOf>[]) => ({ export_format_version: 1, generated_at: "2026-10-18T03:00:00.000Z", sectors, since_last_night: { baseline_generated_at: null, explored_cases: [], stale_cases: [], new_doors: [] } });

const graphOf = (exportData: unknown): Graph => buildGraph(sanitizeExport(exportData).exportData);
const layoutOf = (graph: Graph, expanded: string[] = []): Layout => layoutGraph(graph, new Set(expanded));

function smallExport() {
  return exportOf([
    sectorOf("accounts", [
      doorOf("api:GET /a", "api_call", [caseOf("c1", "robust"), caseOf("c2", "stale")]),
      doorOf("api:GET /b", "api_call", [caseOf("c1")]),
      doorOf("mcp:a", "mcp_tool", [caseOf("tool")], { covered_by_door_id: "api:GET /a" }),
      doorOf("page:/x", "page_route", [caseOf("c1", "fixed")]),
    ]),
    sectorOf("rooms", [doorOf("room-message:kick", "room_message", [caseOf("c1", "weak")])]),
  ]);
}

describe("sanitizeExport", () => {
  it("keeps only the allowed fields at every level", () => {
    const dirty = demoExport({ sectorCount: 2, doorCountPerSector: 8, caseCountPerDoor: 3 });
    Object.assign(dirty, { secret_note: "top leak" });
    Object.assign(dirty.sectors[0], { anchors: ["x"], repro: "curl leak" });
    Object.assign(dirty.sectors[0].doors[0], { finding_id: "fnd_x", source_path: "src/secret.ts" });
    Object.assign(dirty.sectors[0].doors[0].cases[0], { finding_id: "fnd_x", repro: "curl leak" });
    dirty.since_last_night.explored_cases[0].secret_note = "list leak";
    const { exportData } = sanitizeExport(dirty);
    const text = JSON.stringify(exportData);
    for (const leak of ["fnd_x", "anchors", "repro", "curl leak", "secret_note", "src/secret.ts", "list leak"]) expect(text, leak).not.toContain(leak);
    expect(exportData.sectors[0].doors.length).toBeGreaterThan(0);
  });

  it("gives defaults and problems for non-objects, missing fields and wrong types, and never throws", () => {
    for (const bad of [null, undefined, 7, "text", [], { sectors: "no" }, { sectors: [null, 5, { sector_id: 3 }, { sector_id: "a", doors: [{ door_id: "d", cases: "no" }, 4] }] }]) {
      const { exportData, problems } = sanitizeExport(bad);
      expect(Array.isArray(exportData.sectors)).toBe(true);
      expect(problems.length).toBeGreaterThan(0);
    }
    const { exportData } = sanitizeExport({ sectors: [{ sector_id: "a", coverage_pct: 900, door_count: "x", doors: [] }] });
    expect(exportData.sectors[0]).toMatchObject({ sector_id: "a", sector_name: "a", coverage_pct: 100, door_count: 0, doors: [] });
    expect(exportData.since_last_night).toEqual({ baseline_generated_at: null, explored_cases: [], stale_cases: [], new_doors: [] });
  });

  it("shows an unknown status as unexplored, with a problem", () => {
    const { exportData, problems } = sanitizeExport(exportOf([sectorOf("a", [doorOf("d", "api_call", [caseOf("c", "bogus")])])]));
    expect(exportData.sectors[0]!.doors[0]!.cases[0]!.status).toBe("unexplored");
    expect(problems.join()).toContain("bogus");
  });

  it("drops a door holding a hole case, even a nested one, and the door that points at it", () => {
    const nestedHole = { ...caseOf("outer", "robust"), cases: [caseOf("inner", "hole")] };
    const raw = exportOf([
      sectorOf("a", [
        doorOf("api:hole-door", "api_call", [caseOf("c", "hole")]),
        doorOf("api:nested-hole-door", "api_call", [nestedHole as unknown as CaseOf]),
        doorOf("mcp:over-hole", "mcp_tool", [caseOf("t")], { covered_by_door_id: "api:hole-door" }),
        doorOf("api:fine", "api_call", [caseOf("c", "robust")]),
      ]),
    ]);
    const { exportData, problems } = sanitizeExport(raw);
    expect(exportData.sectors[0]!.doors.map((door: { door_id: string }) => door.door_id)).toEqual(["api:fine"]);
    expect(problems.length).toBeGreaterThanOrEqual(2);
    for (const hidden of ["hole-door", "over-hole"]) expect(JSON.stringify(exportData)).not.toContain(hidden);
  });

  it("keeps the first of a repeated door id", () => {
    const { exportData, problems } = sanitizeExport(exportOf([sectorOf("a", [doorOf("d", "api_call", [caseOf("one")]), doorOf("d", "api_call", [caseOf("two")])])]));
    expect(exportData.sectors[0]!.doors).toHaveLength(1);
    expect(exportData.sectors[0]!.doors[0]!.cases[0]!.case_id).toBe("one");
    expect(problems.join()).toContain("twice");
  });
});

describe("buildGraph and visibleNodeIds", () => {
  it("builds root, sectors, kind groups, doors and cases, and leaves out a kind with no doors of its own", () => {
    const graph = graphOf(smallExport());
    const kinds = (kind: string) => [...graph.nodesById.values()].filter((node) => node.nodeKind === kind);
    expect(kinds("root")).toHaveLength(1);
    expect(kinds("sector")).toHaveLength(2);
    expect(kinds("door_kind").map((node) => node.nodeId)).toEqual(["kind:accounts:api_call", "kind:accounts:page_route", "kind:rooms:room_message"]);
    expect(kinds("door")).toHaveLength(5);
    expect(kinds("case")).toHaveLength(2 + 1 + 1 + 1 + 1);
  });

  it("hangs a covered door off its API door as an alias, or under its kind group when the target is missing", () => {
    const graph = graphOf(smallExport());
    const alias = graph.nodesById.get("door:mcp:a")!;
    expect(alias.parentId).toBe("door:api:GET /a");
    expect(alias.isAlias).toBe(true);
    expect(graph.nodesById.get("door:api:GET /a")!.childIds[0]).toBe("door:mcp:a");
    const orphan = graphOf(exportOf([sectorOf("a", [doorOf("mcp:z", "mcp_tool", [caseOf("t")], { covered_by_door_id: "api:gone" })])]));
    expect(orphan.nodesById.get("door:mcp:z")!.parentId).toBe("kind:a:mcp_tool");
    expect(orphan.nodesById.get("door:mcp:z")!.isAlias).toBe(false);
  });

  it("shows cases only for expanded doors, and aliases always", () => {
    const graph = graphOf(smallExport());
    const collapsed = visibleNodeIds(graph, new Set());
    expect([...collapsed].some((id) => id.startsWith("case:"))).toBe(false);
    expect(collapsed.has("door:mcp:a")).toBe(true);
    const expanded = visibleNodeIds(graph, new Set(["door:api:GET /a"]));
    expect(expanded.size - collapsed.size).toBe(2);
    expect(visibleNodeIds(graph, new Set()).size).toBe(collapsed.size);
  });

  it("takes a door's status from its cases in STATUS_ORDER and counts them", () => {
    const graph = graphOf(smallExport());
    expect(displayStatusOf(graph, "door:api:GET /a")).toBe("stale");
    expect(displayStatusOf(graph, "door:api:GET /b")).toBe("unexplored");
    expect(displayStatusOf(graph, "case:api:GET /a|c1")).toBe("robust");
    expect(STATUS_ORDER[0]).toBe("stale");
    const counts = statusCountsOf(graph, "door:api:GET /a");
    expect(Object.values(counts).reduce((sum: number, count) => sum + (count as number), 0)).toBe(2);
    const sectorCounts = statusCountsOf(graph, "sector:accounts");
    expect(Object.values(sectorCounts).reduce((sum: number, count) => sum + (count as number), 0)).toBe(2 + 1 + 1 + 1);
  });

  it("refuses to show every case past MAX_VISIBLE_NODE_COUNT", () => {
    const graph = graphOf(demoExport({ sectorCount: 1, doorCountPerSector: 500, caseCountPerDoor: 15 }));
    const result = expandEverythingUnder(graph, "sector:accounts", new Set());
    expect(result.visibleNodeCount).toBeGreaterThan(MAX_VISIBLE_NODE_COUNT);
    expect(result.isAllowed).toBe(false);
    expect(expandEverythingUnder(graphOf(smallExport()), "sector:accounts", new Set()).isAllowed).toBe(true);
  });
});

function minimumGap(layout: Layout, ids: string[]) {
  let worst = Infinity;
  const entries = ids.map((id) => layout.positionsById.get(id)!);
  const cell = 200;
  const grid = new Map<string, Position[]>();
  for (const position of entries) {
    const key = `${Math.floor(position.x / cell)},${Math.floor(position.y / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), position]);
  }
  for (const position of entries) {
    const cx = Math.floor(position.x / cell);
    const cy = Math.floor(position.y / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (other === position) continue;
          worst = Math.min(worst, Math.hypot(position.x - other.x, position.y - other.y) - position.radius - other.radius);
        }
      }
    }
  }
  return worst;
}

describe("layoutGraph", () => {
  it("is deterministic, and the same for the same export with its doors shuffled", () => {
    const data = demoExport({ sectorCount: 3, doorCountPerSector: 20, caseCountPerDoor: 4 });
    const first = layoutOf(graphOf(data), ["door:demo:door-0001"]);
    const second = layoutOf(graphOf(data), ["door:demo:door-0001"]);
    expect([...first.positionsById]).toEqual([...second.positionsById]);
    const shuffled = structuredClone(data);
    for (const sector of shuffled.sectors) sector.doors.reverse();
    const third = layoutOf(graphOf(shuffled), ["door:demo:door-0001"]);
    expect(Object.fromEntries(third.positionsById)).toEqual(Object.fromEntries(first.positionsById));
  });

  it("never moves a door when another door expands", () => {
    const graph = graphOf(demoExport());
    const before = layoutOf(graph);
    const after = layoutOf(graph, ["door:demo:door-0003", "door:demo:door-0070"]);
    const doorIds = [...graph.nodesById.values()].filter((node) => node.nodeKind === "door" && !node.isAlias).map((node) => node.nodeId);
    expect(doorIds.length).toBeGreaterThan(100);
    for (const doorId of doorIds) expect(after.positionsById.get(doorId)).toEqual(before.positionsById.get(doorId));
  });

  it("keeps every visible node clear of every other", () => {
    const small = graphOf(demoExport());
    const collapsed = layoutOf(small);
    expect(minimumGap(collapsed, [...visibleNodeIds(small, new Set())])).toBeGreaterThanOrEqual(2);
    const ten = [...small.nodesById.values()].filter((node) => node.nodeKind === "door").slice(0, 10).map((node) => node.nodeId);
    const expanded = layoutOf(small, ten);
    expect(minimumGap(expanded, [...visibleNodeIds(small, new Set(ten))])).toBeGreaterThanOrEqual(2);
    const large = graphOf(demoExport({ doorCountPerSector: 400 }));
    expect(minimumGap(layoutOf(large), [...visibleNodeIds(large, new Set())])).toBeGreaterThanOrEqual(2);
  });

  it("gives each sector an arc, the arcs make a circle, and a sector never gets less than the minimum", () => {
    const graph = graphOf(demoExport({ sectorCount: 6, doorCountPerSector: 10 }));
    const lopsided = structuredClone(demoExport({ sectorCount: 6, doorCountPerSector: 60 }));
    lopsided.sectors[5].doors = lopsided.sectors[5].doors.slice(0, 2);
    const layout = layoutOf(graphOf(lopsided));
    const angles = graph.sectorIds.map((id: string) => layout.positionsById.get(`sector:${id}`)!.angleRad);
    expect(angles).toHaveLength(6);
    const lopsidedLayout = layout;
    const sectorAngles = (graphOf(lopsided) as Graph).sectorIds.map((id) => lopsidedLayout.positionsById.get(`sector:${id}`)!.angleRad);
    // The mid-angle gaps between neighbours (and round the circle) add up to one turn; the smallest sector's arc is at least the minimum.
    const gaps = sectorAngles.map((angle, index) => (sectorAngles[(index + 1) % 6]! - angle + 4 * Math.PI) % (2 * Math.PI));
    expect(gaps.reduce((sum, gap) => sum + gap, 0)).toBeCloseTo(2 * Math.PI, 9);
    const smallestArc = Math.min(...gaps.map((gap, index) => (gap + gaps[(index + 5) % 6]!) / 2));
    expect(smallestArc).toBeGreaterThanOrEqual(SECTOR_MIN_ARC_FRACTION * 2 * Math.PI * 0.99);
  });

  it("puts one sector all the way round, and nothing but the root with no sectors", () => {
    const one = layoutOf(graphOf(demoExport({ sectorCount: 1, doorCountPerSector: 12 })));
    expect(one.ringRadii.length).toBeGreaterThan(2);
    expect(Number.isFinite(one.ringRadii[1])).toBe(true);
    const none = layoutOf(graphOf(exportOf([])));
    expect([...none.positionsById.keys()]).toEqual(["root"]);
  });
});

describe("hitTest", () => {
  const data = demoExport({ sectorCount: 2, doorCountPerSector: 12, caseCountPerDoor: 3 });
  const graph = graphOf(data);
  const expandedIds = ["door:demo:door-0001"];
  const layout = layoutOf(graph, expandedIds);
  const visible = visibleNodeIds(graph, new Set(expandedIds));
  const grid = buildHitGrid(layout.positionsById, visible);

  it("finds a node at its centre and nothing beyond the tolerance", () => {
    const position = layout.positionsById.get("door:demo:door-0003")!;
    expect(hitTest(grid, position.x, position.y, 3)).toBe("door:demo:door-0003");
    expect(hitTest(grid, position.x + 400, position.y + 400, 3)).toBeNull();
  });

  it("returns the closer of two nodes, and a larger tolerance reaches a small case", () => {
    const [firstId, secondId] = graph.nodesById.get("kind:accounts:api_call")!.childIds.slice(-2) as [string, string];
    const first = layout.positionsById.get(firstId)!;
    const second = layout.positionsById.get(secondId)!;
    expect(hitTest(grid, first.x + (second.x - first.x) * 0.3, first.y + (second.y - first.y) * 0.3, 150)).toBe(firstId);
    expect(hitTest(grid, first.x + (second.x - first.x) * 0.7, first.y + (second.y - first.y) * 0.7, 150)).toBe(secondId);
    const caseId = [...visible].find((id) => id.startsWith("case:"))!;
    const casePosition = layout.positionsById.get(caseId)!;
    expect(hitTest(grid, casePosition.x + 12, casePosition.y, 2)).not.toBe(caseId);
    expect(hitTest(grid, casePosition.x + 12, casePosition.y, 18)).not.toBeNull();
  });
});

describe("searchDoors and fitView", () => {
  const graph = graphOf(smallExport());

  it("matches by id and name ignoring case, exact id first, at most 20", () => {
    expect(searchDoors(graph, "API:GET /A").map((match: { id: string }) => match.id)).toEqual(["api:GET /a"]);
    expect(searchDoors(graph, "api:get").map((match: { id: string }) => match.id)).toEqual(["api:GET /a", "api:GET /b"]);
    expect(searchDoors(graph, "accounts")[0]).toMatchObject({ nodeKind: "sector" });
    expect(searchDoors(graphOf(demoExport()), "demo").length).toBe(20);
    expect(searchDoors(graph, "")).toEqual([]);
  });

  it("fits the bounds inside the viewport minus its padding", () => {
    const bounds = { minX: -500, minY: -300, maxX: 900, maxY: 700 };
    const { scale, offsetX, offsetY } = fitView(bounds, 800, 600, 24);
    expect(bounds.minX * scale + offsetX).toBeGreaterThanOrEqual(24 - 1e-9);
    expect(bounds.maxX * scale + offsetX).toBeLessThanOrEqual(800 - 24 + 1e-9);
    expect(bounds.minY * scale + offsetY).toBeGreaterThanOrEqual(24 - 1e-9);
    expect(bounds.maxY * scale + offsetY).toBeLessThanOrEqual(600 - 24 + 1e-9);
  });

  it("has a radius for every kind of node", () => {
    expect(Object.keys(NODE_RADIUS_BY_KIND).sort()).toEqual(["case", "door", "door_kind", "root", "sector"]);
  });
});

describe("the built page", () => {
  let workDir = "";
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "security-map-page-"));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("embeds the cleaned data once, with the closing tag of a script escaped", async () => {
    const data = demoExport();
    const html: string = await buildPage(data);
    expect(html.startsWith("<title>Security Map</title>")).toBe(true);
    const blocks = html.match(/<script type="application\/json" id="map-data">([\s\S]*?)<\/script>/g) ?? [];
    expect(blocks).toHaveLength(1);
    const json = blocks[0]!.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    expect(JSON.parse(json)).toEqual(sanitizeExport(data).exportData);
    expect(json).not.toContain("</script");
    expect(json).toContain("\\u003c/script>");
    expect(html).not.toMatch(/@page-|\/\*@page/);
    const withoutData = html.replace(blocks[0]!, "");
    expect(withoutData).not.toMatch(/https?:\/\//);
  });

  it("stays under the size limit with 2,400 doors", async () => {
    const html: string = await buildPage(demoExport({ doorCountPerSector: 400 }));
    expect(Buffer.byteLength(html)).toBeLessThan(MAXIMUM_PAGE_BYTES);
  }, 30_000);

  it("refuses an export that fails its own check, and never carries a stray finding id", async () => {
    const withHole = demoExport({ doorCountPerSector: 6 });
    withHole.sectors[0].doors[0].cases[0].status = "hole";
    await expect(buildPage(withHole)).rejects.toThrow(/Refused to build the map page/);
    const stray = demoExport({ doorCountPerSector: 6 });
    stray.sectors[0].doors[0].cases[0].finding_id = "fnd_stray";
    await expect(buildPage(stray)).rejects.toThrow(/Refused to build the map page/);
    const extraDoorField = demoExport({ doorCountPerSector: 6 });
    extraDoorField.sectors[0].doors[0].anchors = ["fnd_anchor"];
    await expect(buildPage(extraDoorField)).rejects.toThrow(/Refused to build the map page/);
  });

  it("holds no way to read data as markup or to reach the network", () => {
    const forbidden = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "fetch(", "XMLHttpRequest", "WebSocket", "import("];
    for (const file of ["page.mjs", "graph.mjs"]) {
      const source = readFileSync(join(ROOT, "scripts/security-map/page", file), "utf8");
      for (const word of forbidden) expect(source, `${file} has ${word}`).not.toContain(word);
    }
  });

  it("is built by the CLI, which asks where to write and refuses the repos", () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [CLI, "page", ...args], { encoding: "utf8" });
    const missingOut = run();
    expect(missingOut.status).toBe(1);
    expect(missingOut.stderr).toContain("page needs --out <path>");
    const inRepo = run("--demo", "5", "--out", join(ROOT, "docs/security-map-test.html"));
    expect(inRepo.status).toBe(1);
    expect(inRepo.stderr).toContain("Write the page outside the repos");
    const both = run("--demo", "5", "--export", "x.json", "--out", join(workDir, "p.html"));
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("Use --export or --demo, not both.");
    const built = run("--demo", "20", "--out", join(workDir, "p.html"));
    expect(built.status, built.stderr).toBe(0);
    expect(readFileSync(join(workDir, "p.html"), "utf8").startsWith("<title>Security Map</title>")).toBe(true);
    writeFileSync(join(workDir, "unused"), "");
  }, 30_000);
});
