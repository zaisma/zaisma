import { DOOR_KINDS } from "../schema.mjs";

/**
 * The Security map page's logic with no DOM: it cleans the export, turns it into a tree, lays the tree out
 * as a radial map and finds what's under a pointer. The page bundle and the Node tests both import it, so
 * what the tests check is what the page runs. The page's rules are in docs/plans/security-map-page.md
 * (until the slice is done) and the `security-map` skill's Page section.
 */

/** The precedence a door, kind group or sector takes from its cases: the first status present wins. */
export const STATUS_ORDER = ["stale", "weak", "unexplored", "fixed", "robust"];
const TIERS = ["urgent", "important", "hardening"];
const EVIDENCE_KINDS = ["test", "ship_check", "probe"];
const MAX_PROBLEM_COUNT = 200;
const MAX_CASE_NESTING_DEPTH = 12;

/** The fields the page keeps at each level of the export; anything else is dropped. */
export const ALLOWED_FIELDS = {
  top: ["export_format_version", "generated_at", "sectors", "since_last_night"],
  sector: ["sector_id", "sector_name", "attacker_goal", "coverage_pct", "door_count", "case_count", "done_case_count", "hole_count_by_tier", "hole_count_by_tier_at_baseline", "doors"],
  hole_count_by_tier: TIERS,
  door: ["door_id", "door_name", "door_kind", "covered_by_door_id", "door_removed_at", "cases"],
  case: ["case_id", "case_name", "status", "severity_tier", "last_checked_at", "evidence", "stale_reason", "cases"],
  evidence: ["kind", "ref", "note"],
  since_last_night: ["baseline_generated_at", "explored_cases", "stale_cases", "new_doors"],
  explored_case: ["sector_id", "door_id", "case_id", "case_name", "status"],
  stale_case: ["sector_id", "door_id", "case_id", "case_name", "stale_reason"],
  new_door: ["sector_id", "door_id", "door_name", "door_kind"],
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const compare = (first, second) => (first < second ? -1 : first > second ? 1 : 0);

function emptySinceLastNight() {
  return { baseline_generated_at: null, explored_cases: [], stale_cases: [], new_doors: [] };
}

/**
 * The export as the page may use it: only ALLOWED_FIELDS, copied into fresh objects with defaults for what's
 * missing, so a stray field never reaches the page. Never throws. A door with a hole case (nested ones
 * included) is dropped with a problem, before any status is looked at, so a hole is never drawn.
 */
export function sanitizeExport(raw) {
  const problems = [];
  const note = (text) => {
    if (problems.length < MAX_PROBLEM_COUNT) problems.push(text);
  };
  const text = (value, path, fallback = "") => {
    if (typeof value === "string") return value;
    note(`${path} isn't text`);
    return fallback;
  };
  const optionalText = (value, path) => {
    if (value === null || value === undefined) return null;
    return text(value, path, null);
  };
  const time = (value, path) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
    note(`${path} isn't a time`);
    return null;
  };
  const count = (value, path) => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
    note(`${path} isn't a count`);
    return 0;
  };
  const tierCounts = (value, path) => {
    if (!isObject(value)) {
      note(`${path} isn't an object`);
      return { urgent: 0, important: 0, hardening: 0 };
    }
    return Object.fromEntries(TIERS.map((tier) => [tier, count(value[tier], `${path}.${tier}`)]));
  };

  if (!isObject(raw)) {
    note("the map data isn't an object");
    return { exportData: { export_format_version: 1, generated_at: null, sectors: [], since_last_night: emptySinceLastNight() }, problems };
  }

  const hasHole = (cases, nesting = 0) => Array.isArray(cases) && cases.some((theCase) => isObject(theCase) && (theCase.status === "hole" || (nesting < MAX_CASE_NESTING_DEPTH && hasHole(theCase.cases, nesting + 1))));

  function cleanEvidence(value, path) {
    if (value === null || value === undefined) return null;
    if (!isObject(value)) {
      note(`${path} isn't an object`);
      return null;
    }
    const kind = text(value.kind, `${path}.kind`);
    if (!EVIDENCE_KINDS.includes(kind)) note(`${path}.kind is ${JSON.stringify(kind)}`);
    return { kind, ref: text(value.ref, `${path}.ref`), note: typeof value.note === "string" ? value.note : "" };
  }

  function cleanCase(rawCase, path, nesting) {
    if (!isObject(rawCase)) {
      note(`${path} isn't an object`);
      return null;
    }
    const caseId = text(rawCase.case_id, `${path}.case_id`);
    if (!caseId) return null;
    let status = rawCase.status;
    if (!STATUS_ORDER.includes(status)) {
      note(`${path} has the status ${JSON.stringify(status)}, shown as unexplored`);
      status = "unexplored";
    }
    const tier = rawCase.severity_tier;
    const cleaned = {
      case_id: caseId,
      case_name: text(rawCase.case_name, `${path}.case_name`, caseId),
      status,
      severity_tier: TIERS.includes(tier) ? tier : null,
      last_checked_at: time(rawCase.last_checked_at, `${path}.last_checked_at`),
      evidence: status === "robust" || status === "weak" || status === "fixed" ? cleanEvidence(rawCase.evidence, `${path}.evidence`) : null,
      stale_reason: status === "stale" ? optionalText(rawCase.stale_reason, `${path}.stale_reason`) : null,
    };
    if (Array.isArray(rawCase.cases) && rawCase.cases.length) {
      if (nesting >= MAX_CASE_NESTING_DEPTH) note(`${path} nests cases deeper than ${MAX_CASE_NESTING_DEPTH}`);
      else cleaned.cases = rawCase.cases.map((nested, index) => cleanCase(nested, `${path}.cases[${index}]`, nesting + 1)).filter(Boolean);
    }
    return cleaned;
  }

  function cleanDoor(rawDoor, path) {
    if (!isObject(rawDoor)) {
      note(`${path} isn't an object`);
      return null;
    }
    const doorId = text(rawDoor.door_id, `${path}.door_id`);
    if (!doorId) return null;
    if (hasHole(rawDoor.cases)) {
      note(`the door ${doorId} holds a hole case, so it was dropped`);
      droppedDoorIds.add(doorId);
      return null;
    }
    const rawCases = Array.isArray(rawDoor.cases) ? rawDoor.cases : (note(`${path}.cases isn't a list`), []);
    return {
      door_id: doorId,
      door_name: text(rawDoor.door_name, `${path}.door_name`, doorId),
      door_kind: text(rawDoor.door_kind, `${path}.door_kind`),
      covered_by_door_id: optionalText(rawDoor.covered_by_door_id, `${path}.covered_by_door_id`),
      door_removed_at: time(rawDoor.door_removed_at, `${path}.door_removed_at`),
      cases: rawCases.map((theCase, index) => cleanCase(theCase, `${path}.cases[${index}]`, 0)).filter(Boolean),
    };
  }

  const seenDoorIds = new Set();
  const droppedDoorIds = new Set();
  const seenSectorIds = new Set();
  const rawSectors = Array.isArray(raw.sectors) ? raw.sectors : (note("sectors isn't a list"), []);
  const sectors = [];
  rawSectors.forEach((rawSector, index) => {
    const path = `sectors[${index}]`;
    if (!isObject(rawSector)) return note(`${path} isn't an object`);
    const sectorId = text(rawSector.sector_id, `${path}.sector_id`);
    if (!sectorId) return;
    if (seenSectorIds.has(sectorId)) return note(`the sector ${sectorId} is in the export twice, so the first one was kept`);
    seenSectorIds.add(sectorId);
    const rawDoors = Array.isArray(rawSector.doors) ? rawSector.doors : (note(`${path}.doors isn't a list`), []);
    const doors = [];
    rawDoors.forEach((rawDoor, doorIndex) => {
      const door = cleanDoor(rawDoor, `${path}.doors[${doorIndex}]`);
      if (!door) return;
      if (seenDoorIds.has(door.door_id)) return note(`the door ${door.door_id} is in the export twice, so the first one was kept`);
      seenDoorIds.add(door.door_id);
      doors.push(door);
    });
    const coverage = typeof rawSector.coverage_pct === "number" && Number.isFinite(rawSector.coverage_pct) ? Math.min(100, Math.max(0, Math.round(rawSector.coverage_pct))) : (note(`${path}.coverage_pct isn't a number`), 0);
    sectors.push({
      sector_id: sectorId,
      sector_name: text(rawSector.sector_name, `${path}.sector_name`, sectorId),
      attacker_goal: text(rawSector.attacker_goal, `${path}.attacker_goal`),
      coverage_pct: coverage,
      door_count: count(rawSector.door_count, `${path}.door_count`),
      case_count: count(rawSector.case_count, `${path}.case_count`),
      done_case_count: count(rawSector.done_case_count, `${path}.done_case_count`),
      hole_count_by_tier: tierCounts(rawSector.hole_count_by_tier, `${path}.hole_count_by_tier`),
      hole_count_by_tier_at_baseline: rawSector.hole_count_by_tier_at_baseline === null || rawSector.hole_count_by_tier_at_baseline === undefined ? null : tierCounts(rawSector.hole_count_by_tier_at_baseline, `${path}.hole_count_by_tier_at_baseline`),
      doors,
    });
  });
  // A door covered by a dropped door would point at it.
  for (const sector of sectors) {
    sector.doors = sector.doors.filter((door) => {
      if (door.covered_by_door_id && droppedDoorIds.has(door.covered_by_door_id)) {
        note(`the door ${door.door_id} is covered by a dropped door, so it was dropped too`);
        return false;
      }
      return true;
    });
  }

  const rawSince = isObject(raw.since_last_night) ? raw.since_last_night : (note("since_last_night isn't an object"), {});
  const list = (value, path, fields) => {
    if (!Array.isArray(value)) {
      note(`${path} isn't a list`);
      return [];
    }
    return value.filter(isObject).map((item) => Object.fromEntries(fields.map((field) => [field, typeof item[field] === "string" ? item[field] : field === "stale_reason" ? null : ""])));
  };
  const sinceLastNight = {
    baseline_generated_at: time(rawSince.baseline_generated_at, "since_last_night.baseline_generated_at"),
    explored_cases: list(rawSince.explored_cases, "since_last_night.explored_cases", ALLOWED_FIELDS.explored_case),
    stale_cases: list(rawSince.stale_cases, "since_last_night.stale_cases", ALLOWED_FIELDS.stale_case),
    new_doors: list(rawSince.new_doors, "since_last_night.new_doors", ALLOWED_FIELDS.new_door),
  };
  return {
    exportData: {
      export_format_version: typeof raw.export_format_version === "number" ? raw.export_format_version : 1,
      generated_at: time(raw.generated_at, "generated_at"),
      sectors,
      since_last_night: sinceLastNight,
    },
    problems,
  };
}

// ---------------------------------------------------------------- the tree

const KIND_LABELS = {
  api_call: "API calls",
  mcp_tool: "MCP tools",
  admin_tool: "Admin tools",
  page_form: "Page forms",
  page_route: "Pages",
  game_file_address: "Game-file addresses",
  room_message: "Room messages",
  token_or_session: "Keys and sessions",
};

export const kindLabelOf = (doorKind) => KIND_LABELS[doorKind] ?? doorKind;

/**
 * The map as a tree: root → sectors → one group per door kind → doors → cases (nested cases below them).
 * A door that another covers (an MCP tool over its API call) hangs off that door as an alias instead.
 * A kind group with no doors of its own (every MCP tool is an alias) isn't drawn.
 */
export function buildGraph(exportData) {
  const nodesById = new Map();
  const add = (node) => {
    nodesById.set(node.nodeId, { childIds: [], isAlias: false, ...node });
    if (node.parentId) nodesById.get(node.parentId).childIds.push(node.nodeId);
    return node.nodeId;
  };
  const rootId = "root";
  add({ nodeId: rootId, nodeKind: "root", parentId: null, depth: 0, sectorId: null, label: "zaisma", status: "unexplored", source: exportData });
  const sectorIds = [];
  const addCases = (cases, parentId, doorId, depth, path, sectorId) => {
    for (const theCase of cases) {
      const caseKey = `${path}|${theCase.case_id}`;
      const nodeId = add({ nodeId: `case:${caseKey}`, nodeKind: "case", parentId, depth, sectorId, label: theCase.case_name, status: theCase.status, source: theCase, doorId });
      addCases(theCase.cases ?? [], nodeId, doorId, depth + 1, caseKey, sectorId);
    }
  };
  for (const sector of exportData.sectors) {
    const sectorNodeId = add({ nodeId: `sector:${sector.sector_id}`, nodeKind: "sector", parentId: rootId, depth: 1, sectorId: sector.sector_id, label: sector.sector_name, status: "unexplored", source: sector });
    sectorIds.push(sector.sector_id);
    const doors = [...sector.doors].sort((first, second) => compare(first.door_id, second.door_id));
    const doorIdsInSector = new Set(doors.map((door) => door.door_id));
    const isAlias = (door) => Boolean(door.covered_by_door_id) && doorIdsInSector.has(door.covered_by_door_id);
    const groupDoors = (doorKind) => doors.filter((door) => door.door_kind === doorKind && !isAlias(door));
    const kinds = [...DOOR_KINDS, ...new Set(doors.map((door) => door.door_kind).filter((doorKind) => !DOOR_KINDS.includes(doorKind)))].filter((doorKind) => groupDoors(doorKind).length);
    for (const doorKind of kinds) {
      const kindNodeId = add({ nodeId: `kind:${sector.sector_id}:${doorKind}`, nodeKind: "door_kind", parentId: sectorNodeId, depth: 2, sectorId: sector.sector_id, label: kindLabelOf(doorKind), status: "unexplored", source: { door_kind: doorKind } });
      for (const door of groupDoors(doorKind)) {
        const doorNodeId = add({ nodeId: `door:${door.door_id}`, nodeKind: "door", parentId: kindNodeId, depth: 3, sectorId: sector.sector_id, label: door.door_name, status: "unexplored", source: door });
        addCases(door.cases, doorNodeId, door.door_id, 4, door.door_id, sector.sector_id);
      }
    }
    // Aliases go in after their door's own cases are added, then moved first among its children.
    for (const door of doors.filter(isAlias)) {
      const parentId = `door:${door.covered_by_door_id}`;
      const parent = nodesById.get(parentId);
      const aliasId = add({ nodeId: `door:${door.door_id}`, nodeKind: "door", parentId, depth: parent.depth + 1, sectorId: sector.sector_id, label: door.door_name, status: "unexplored", source: door, isAlias: true });
      parent.childIds = [aliasId, ...parent.childIds.filter((childId) => childId !== aliasId)];
      addCases(door.cases, aliasId, door.door_id, parent.depth + 2, door.door_id, sector.sector_id);
    }
  }
  const graph = { nodesById, rootId, sectorIds, statusCountsByNodeId: new Map() };
  // A node's displayed status comes from its cases, so it's known once the tree is built.
  for (const node of nodesById.values()) node.status = displayStatusOf(graph, node.nodeId);
  return graph;
}

const isCaseNode = (node) => node.nodeKind === "case";

function ownCountsOf(graph, node) {
  const counts = { unexplored: 0, robust: 0, weak: 0, fixed: 0, stale: 0 };
  const walk = (parent) => {
    for (const childId of parent.childIds) {
      const child = graph.nodesById.get(childId);
      if (!isCaseNode(child)) continue;
      counts[child.source.status] += 1;
      walk(child);
    }
  };
  if (isCaseNode(node)) {
    counts[node.source.status] += 1;
    walk(node);
  } else walk(node);
  return counts;
}

/** How many cases of each status a node holds: a door's own (nested included), or all those below a sector, kind group or the root. */
export function statusCountsOf(graph, nodeId) {
  const cached = graph.statusCountsByNodeId.get(nodeId);
  if (cached) return cached;
  const node = graph.nodesById.get(nodeId);
  let counts;
  if (node.nodeKind === "door" || isCaseNode(node)) counts = ownCountsOf(graph, node);
  else {
    counts = { unexplored: 0, robust: 0, weak: 0, fixed: 0, stale: 0 };
    const addDoors = (parent) => {
      for (const childId of parent.childIds) {
        const child = graph.nodesById.get(childId);
        if (child.nodeKind === "case") continue;
        if (child.nodeKind === "door") {
          const own = statusCountsOf(graph, childId);
          for (const status of STATUS_ORDER) counts[status] += own[status];
        }
        addDoors(child);
      }
    };
    addDoors(node);
  }
  graph.statusCountsByNodeId.set(nodeId, counts);
  return counts;
}

/** A case's own status; a door, kind group, sector or the root takes the first STATUS_ORDER status among its cases. */
export function displayStatusOf(graph, nodeId) {
  const node = graph.nodesById.get(nodeId);
  if (isCaseNode(node)) return node.source.status;
  const counts = statusCountsOf(graph, nodeId);
  return STATUS_ORDER.find((status) => counts[status] > 0) ?? "unexplored";
}

/** Root, sectors, kind groups, doors and aliases always; a door's or case's case children only when it's in expandedIds. */
export function visibleNodeIds(graph, expandedIds = new Set()) {
  const visible = new Set();
  const walk = (nodeId) => {
    visible.add(nodeId);
    const node = graph.nodesById.get(nodeId);
    for (const childId of node.childIds) {
      const child = graph.nodesById.get(childId);
      if (isCaseNode(child) && !expandedIds.has(nodeId)) continue;
      walk(childId);
    }
  };
  walk(graph.rootId);
  return visible;
}

/** A list of ids to expand so that nodeId is on screen: every ancestor that holds cases. */
export function expandedIdsToReveal(graph, nodeId) {
  const ids = [];
  for (let node = graph.nodesById.get(nodeId); node?.parentId; node = graph.nodesById.get(node.parentId)) {
    const parent = graph.nodesById.get(node.parentId);
    if (isCaseNode(node) && (parent.nodeKind === "door" || isCaseNode(parent))) ids.push(parent.nodeId);
  }
  return ids;
}

export const MAX_VISIBLE_NODE_COUNT = 6000;

/** "Show every case" for a sector or kind group: the ids to expand and how many nodes that shows, or null past MAX_VISIBLE_NODE_COUNT. */
export function expandEverythingUnder(graph, nodeId, expandedIds) {
  const next = new Set(expandedIds);
  const walk = (id) => {
    const node = graph.nodesById.get(id);
    if (node.nodeKind === "door" || isCaseNode(node)) if (node.childIds.some((childId) => isCaseNode(graph.nodesById.get(childId)))) next.add(id);
    for (const childId of node.childIds) walk(childId);
  };
  walk(nodeId);
  const visibleNodeCount = visibleNodeIds(graph, next).size;
  return { expandedIds: next, visibleNodeCount, isAllowed: visibleNodeCount <= MAX_VISIBLE_NODE_COUNT };
}

// ---------------------------------------------------------------- the layout

export const NODE_RADIUS_BY_KIND = { root: 34, sector: 46, door_kind: 16, door: 7, case: 4.5 };
export const SECTOR_MIN_ARC_FRACTION = 0.06;
export const SECTOR_PAD_FRACTION = 0.03;
export const RING_BASE_RADIUS = [0, 260, 440, 680, 900];
export const RING_MIN_GAP = 160;
export const NODE_SPACING_BY_DEPTH = [0, 116, 44, 20, 18];
const BASE_RADIUS_STEP_BEYOND = 210;
const SPACING_BEYOND = 13;
const START_ANGLE_RAD = -Math.PI / 2;
const TWO_PI = Math.PI * 2;

const ringBaseRadiusOf = (depth) => RING_BASE_RADIUS[depth] ?? RING_BASE_RADIUS.at(-1) + (depth - (RING_BASE_RADIUS.length - 1)) * BASE_RADIUS_STEP_BEYOND;
const spacingOf = (depth) => NODE_SPACING_BY_DEPTH[depth] ?? SPACING_BEYOND;

/** Each sector's share of the circle: its door count, with a minimum, the rest scaled so the total is one. */
function sectorFractions(doorCounts) {
  const sectorCount = doorCounts.length;
  if (sectorCount === 0) return [];
  const minimum = sectorCount > 16 ? 0.9 / sectorCount : SECTOR_MIN_ARC_FRACTION;
  const total = doorCounts.reduce((sum, count) => sum + count, 0);
  const wanted = doorCounts.map((count) => (total === 0 ? 1 / sectorCount : count / total));
  const isRaised = wanted.map(() => false);
  let fractions = wanted;
  for (let pass = 0; pass <= sectorCount; pass += 1) {
    const raisedCount = isRaised.filter(Boolean).length;
    const freeShare = wanted.reduce((sum, share, index) => sum + (isRaised[index] ? 0 : share), 0);
    const room = 1 - raisedCount * minimum;
    fractions = wanted.map((share, index) => (isRaised[index] ? minimum : freeShare === 0 ? room / (sectorCount - raisedCount) : (share / freeShare) * room));
    const next = fractions.findIndex((fraction, index) => !isRaised[index] && fraction < minimum);
    if (next === -1) break;
    isRaised[next] = true;
  }
  return fractions;
}

/**
 * Separates items on a ring: sorted by (desired angle, nodeId), swept left to right so each is at least `separation`
 * past the one before (the first starting no earlier than `startAngle`), then right to left from `endAngle`.
 * Items are { nodeId, desiredAngle }; returns Map<nodeId, angle>.
 */
export function spreadOnRing(items, separation, startAngle, endAngle) {
  const sorted = [...items].sort((first, second) => first.desiredAngle - second.desiredAngle || compare(first.nodeId, second.nodeId));
  const angles = sorted.map((item) => item.desiredAngle);
  // The first is held at startAngle before the sweep, so the sweep carries everything after it clear of it.
  if (angles.length) angles[0] = Math.max(angles[0], startAngle);
  for (let index = 1; index < angles.length; index += 1) angles[index] = Math.max(angles[index], angles[index - 1] + separation);
  for (let index = angles.length - 1; index >= 0; index -= 1) {
    angles[index] = index === angles.length - 1 ? Math.min(angles[index], endAngle) : Math.min(angles[index], angles[index + 1] - separation);
  }
  // The ring radius leaves room for every item, so pulling them back from the end never takes the first past startAngle.
  return new Map(sorted.map((item, index) => [item.nodeId, angles[index]]));
}

/**
 * Where each visible node goes, as a pure function of the export and expandedIds (no randomness): the same data
 * draws the same map every night. Doors never move when something expands. Angles start at the top and run clockwise.
 */
export function layoutGraph(graph, expandedIds = new Set()) {
  const visible = visibleNodeIds(graph, expandedIds);
  const positionsById = new Map();
  const root = graph.nodesById.get(graph.rootId);
  positionsById.set(root.nodeId, { x: 0, y: 0, angleRad: 0, depth: 0, radius: NODE_RADIUS_BY_KIND.root });
  const sectorNodes = graph.sectorIds.map((sectorId) => graph.nodesById.get(`sector:${sectorId}`));
  if (sectorNodes.length === 0) return { positionsById, ringRadii: [], bounds: boundsOf(positionsById, [...positionsById.keys()]) };

  const doorCountOf = (sectorNode) => {
    let doorCount = 0;
    const walk = (node) => {
      if (node.nodeKind === "door") doorCount += 1;
      for (const childId of node.childIds) walk(graph.nodesById.get(childId));
    };
    walk(sectorNode);
    return doorCount;
  };
  const fractions = sectorFractions(sectorNodes.map(doorCountOf));
  const arcs = [];
  let cursor = START_ANGLE_RAD;
  for (const fraction of fractions) {
    const span = fraction * TWO_PI;
    const pad = span * SECTOR_PAD_FRACTION;
    arcs.push({ start: cursor, span, usableStart: cursor + pad, usableEnd: cursor + span - pad, usableSpan: span - 2 * pad });
    cursor += span;
  }
  const arcBySectorId = new Map(sectorNodes.map((node, index) => [node.sectorId, arcs[index]]));

  const visibleNodes = [...visible].map((nodeId) => graph.nodesById.get(nodeId));
  const maxDepth = Math.max(...visibleNodes.map((node) => node.depth));
  const countBySectorAndDepth = new Map();
  for (const node of visibleNodes) {
    if (node.depth < 1) continue;
    const key = `${node.sectorId}:${node.depth}`;
    countBySectorAndDepth.set(key, (countBySectorAndDepth.get(key) ?? 0) + 1);
  }
  const ringRadii = [0];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let needed = 0;
    if (depth === 1) {
      const smallestSpan = Math.min(...arcs.map((arc) => arc.span));
      needed = arcs.length > 1 ? spacingOf(1) / (2 * Math.sin(smallestSpan / 2)) : 0;
    } else {
      for (const sectorNode of sectorNodes) {
        const count = countBySectorAndDepth.get(`${sectorNode.sectorId}:${depth}`) ?? 0;
        needed = Math.max(needed, (1.02 * count * spacingOf(depth)) / arcBySectorId.get(sectorNode.sectorId).usableSpan);
      }
    }
    ringRadii.push(Math.max(ringBaseRadiusOf(depth), ringRadii[depth - 1] + RING_MIN_GAP, needed));
  }

  const angleById = new Map([[root.nodeId, 0]]);
  const place = (node, angle) => {
    angleById.set(node.nodeId, angle);
    const radiusOnRing = ringRadii[node.depth];
    positionsById.set(node.nodeId, { x: radiusOnRing * Math.cos(angle), y: radiusOnRing * Math.sin(angle), angleRad: angle, depth: node.depth, radius: NODE_RADIUS_BY_KIND[node.nodeKind] });
  };

  // Depth 1: the middle of each sector's arc. Depth 3 first, since doors are fixed by the counts alone.
  for (const sectorNode of sectorNodes) {
    const arc = arcBySectorId.get(sectorNode.sectorId);
    place(sectorNode, arc.start + arc.span / 2);
  }
  const desiredAngleByKindId = new Map();
  for (const sectorNode of sectorNodes) {
    const arc = arcBySectorId.get(sectorNode.sectorId);
    const kindNodes = sectorNode.childIds.map((childId) => graph.nodesById.get(childId));
    const doorTotal = kindNodes.reduce((sum, kindNode) => sum + kindNode.childIds.length, 0);
    let consumed = 0;
    for (const kindNode of kindNodes) {
      const doorIds = kindNode.childIds;
      const subStart = arc.usableStart + (consumed / doorTotal) * arc.usableSpan;
      const subSpan = (doorIds.length / doorTotal) * arc.usableSpan;
      doorIds.forEach((doorId, index) => place(graph.nodesById.get(doorId), subStart + ((index + 0.5) / doorIds.length) * subSpan));
      desiredAngleByKindId.set(kindNode.nodeId, subStart + subSpan / 2);
      consumed += doorIds.length;
    }
  }
  // Depth 2: kind groups, spread apart within the sector's arc.
  const separationOf = (depth) => spacingOf(depth) / ringRadii[depth];
  for (const sectorNode of sectorNodes) {
    const arc = arcBySectorId.get(sectorNode.sectorId);
    const items = sectorNode.childIds.map((kindId) => ({ nodeId: kindId, desiredAngle: desiredAngleByKindId.get(kindId) }));
    for (const [nodeId, angle] of spreadOnRing(items, separationOf(2), arc.usableStart, arc.usableEnd)) place(graph.nodesById.get(nodeId), angle);
  }
  // Depth 4 and beyond: each node fans out around its parent's angle, then the ring is spread.
  for (let depth = 4; depth <= maxDepth; depth += 1) {
    const separation = separationOf(depth);
    for (const sectorNode of sectorNodes) {
      const arc = arcBySectorId.get(sectorNode.sectorId);
      const items = [];
      for (const node of visibleNodes) {
        if (node.depth !== depth - 1 || node.sectorId !== sectorNode.sectorId) continue;
        const children = node.childIds.filter((childId) => visible.has(childId) && graph.nodesById.get(childId).depth === depth);
        children.forEach((childId, index) => items.push({ nodeId: childId, desiredAngle: angleById.get(node.nodeId) + (index - (children.length - 1) / 2) * separation }));
      }
      for (const [nodeId, angle] of spreadOnRing(items, separation, arc.usableStart, arc.usableEnd)) place(graph.nodesById.get(nodeId), angle);
    }
  }

  return { positionsById, ringRadii, bounds: boundsOf(positionsById, [...positionsById.keys()]) };
}

/** The box around some positioned nodes, plus 60 world units. */
export function boundsOf(positionsById, nodeIds, margin = 60) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const nodeId of nodeIds) {
    const position = positionsById.get(nodeId);
    if (!position) continue;
    minX = Math.min(minX, position.x - position.radius);
    minY = Math.min(minY, position.y - position.radius);
    maxX = Math.max(maxX, position.x + position.radius);
    maxY = Math.max(maxY, position.y + position.radius);
  }
  if (minX === Infinity) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

/** The scale and offset (screen = world × scale + offset) that put `bounds` in the middle of the viewport with some padding. */
export function fitView(bounds, viewportWidthPx, viewportHeightPx, paddingPx = 24) {
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.max(0.0001, Math.min((viewportWidthPx - 2 * paddingPx) / boundsWidth, (viewportHeightPx - 2 * paddingPx) / boundsHeight));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return { scale, offsetX: viewportWidthPx / 2 - centerX * scale, offsetY: viewportHeightPx / 2 - centerY * scale };
}

// ---------------------------------------------------------------- finding a node

export const HIT_CELL_SIZE_WORLD = 48;

/** A uniform grid of the visible nodes, rebuilt after each layout. */
export function buildHitGrid(positionsById, visibleIds) {
  const cells = new Map();
  let largestRadius = 0;
  for (const nodeId of visibleIds) {
    const position = positionsById.get(nodeId);
    if (!position) continue;
    largestRadius = Math.max(largestRadius, position.radius);
    const key = `${Math.floor(position.x / HIT_CELL_SIZE_WORLD)},${Math.floor(position.y / HIT_CELL_SIZE_WORLD)}`;
    const cell = cells.get(key);
    if (cell) cell.push({ nodeId, x: position.x, y: position.y, radius: position.radius });
    else cells.set(key, [{ nodeId, x: position.x, y: position.y, radius: position.radius }]);
  }
  return { cells, largestRadius };
}

/** The closest node within max(its radius, toleranceWorld) of the point, or null. */
export function hitTest(hitGrid, worldX, worldY, toleranceWorld) {
  const reach = Math.min(12, Math.ceil(Math.max(toleranceWorld, hitGrid.largestRadius) / HIT_CELL_SIZE_WORLD));
  const cellX = Math.floor(worldX / HIT_CELL_SIZE_WORLD);
  const cellY = Math.floor(worldY / HIT_CELL_SIZE_WORLD);
  let best = null;
  let bestDistance = Infinity;
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const cell = hitGrid.cells.get(`${cellX + dx},${cellY + dy}`);
      if (!cell) continue;
      for (const entry of cell) {
        const distance = Math.hypot(entry.x - worldX, entry.y - worldY);
        if (distance <= Math.max(entry.radius, toleranceWorld) && (distance < bestDistance || (distance === bestDistance && compare(entry.nodeId, best) < 0))) {
          best = entry.nodeId;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

/** Doors and sectors whose id or name contains the query, ignoring case: exact id matches first, then by id. */
export function searchDoors(graph, query, limitCount = 20) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return [];
  const matches = [];
  for (const node of graph.nodesById.values()) {
    if (node.nodeKind !== "door" && node.nodeKind !== "sector") continue;
    const id = node.nodeKind === "door" ? node.source.door_id : node.source.sector_id;
    if (id.toLowerCase().includes(needle) || node.label.toLowerCase().includes(needle)) matches.push({ nodeId: node.nodeId, nodeKind: node.nodeKind, id, name: node.label });
  }
  const rank = (match) => (match.id.toLowerCase() === needle ? 0 : 1);
  return matches.sort((first, second) => rank(first) - rank(second) || compare(first.id, second.id)).slice(0, limitCount);
}
