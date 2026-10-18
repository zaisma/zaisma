import { SECTORS } from "../schema.mjs";

/**
 * A made-up export in the real export's shape, for the page's tests and its browser checks. Every id is fake
 * (`demo:door-0001`, `demo:case-01`); it is never published. It cycles every status, has an MCP alias door
 * for every few API doors, a removed door, nested cases, hole counts, a baseline with all three
 * since_last_night lists filled, and one door name that tries to close the page's script tag.
 */

const STATUS_CYCLE = ["unexplored", "robust", "weak", "fixed", "stale", "robust", "unexplored", "robust"];
const KIND_CYCLE = ["api_call", "api_call", "page_form", "api_call", "page_route", "game_file_address", "api_call", "admin_tool", "room_message", "token_or_session"];
const pad = (number, width) => String(number).padStart(width, "0");
const DEMO_TIME = "2026-10-17T22:00:00.000Z";
const GENERATED_AT = "2026-10-18T03:00:00.000Z";
const BASELINE_AT = "2026-10-17T03:00:00.000Z";

function demoCase(caseNumber, status, tierSeed) {
  const hasEvidence = status === "robust" || status === "weak" || status === "fixed";
  return {
    case_id: `demo:case-${pad(caseNumber, 2)}`,
    case_name: `Demo attack ${caseNumber}`,
    status,
    severity_tier: status === "weak" ? (tierSeed % 2 ? "hardening" : "important") : null,
    last_checked_at: status === "unexplored" ? null : DEMO_TIME,
    evidence: hasEvidence ? { kind: ["test", "ship_check", "probe"][tierSeed % 3], ref: `test/demo/case-${pad(caseNumber, 2)}.test.ts`, note: `Demo evidence for attack ${caseNumber}.` } : null,
    stale_reason: status === "stale" ? "src/demo.ts:guard changed since the verdict" : null,
  };
}

export function demoExport({ sectorCount = 6, doorCountPerSector = 60, caseCountPerDoor = 15 } = {}) {
  let doorNumber = 0;
  const allCases = [];
  const sectors = Array.from({ length: sectorCount }, (_, sectorIndex) => {
    const base = SECTORS[sectorIndex] ?? { sector_id: `demo-sector-${sectorIndex + 1}`, sector_name: `Demo sector ${sectorIndex + 1}`, attacker_goal: "Reach something a demo sector protects." };
    const doors = [];
    let lastApiDoorId = null;
    for (let position = 0; position < doorCountPerSector; position += 1) {
      doorNumber += 1;
      const doorId = `demo:door-${pad(doorNumber, 4)}`;
      const isAlias = position % 6 === 5 && lastApiDoorId !== null;
      const doorKind = isAlias ? "mcp_tool" : KIND_CYCLE[position % KIND_CYCLE.length];
      const cases = [];
      for (let caseIndex = 0; caseIndex < (isAlias ? 1 : caseCountPerDoor); caseIndex += 1) {
        const theCase = demoCase(caseIndex + 1, STATUS_CYCLE[(doorNumber + caseIndex) % STATUS_CYCLE.length], doorNumber + caseIndex);
        cases.push(theCase);
        allCases.push({ sector_id: base.sector_id, door_id: doorId, theCase });
      }
      if (doorNumber === 1 && cases[0]) cases[0].cases = [demoCase(1, "robust", 1), demoCase(2, "weak", 2), demoCase(3, "unexplored", 3)].map((nested, index) => ({ ...nested, case_id: `demo:nested-${index + 1}`, case_name: `Nested demo attack ${index + 1}` }));
      doors.push({
        door_id: doorId,
        door_name: doorNumber === 2 ? "demo </script><b>x" : `${doorKind === "mcp_tool" ? "demo_tool" : `GET /api/demo/${doorNumber}`}`,
        door_kind: doorKind,
        covered_by_door_id: isAlias ? lastApiDoorId : null,
        door_removed_at: doorNumber === 4 ? "2026-10-15T03:00:00.000Z" : null,
        cases,
      });
      if (doorKind === "api_call") lastApiDoorId = doorId;
    }
    const allSectorCases = doors.flatMap((door) => door.cases);
    const doneCount = allSectorCases.filter((theCase) => theCase.status === "robust" || theCase.status === "fixed").length;
    return {
      sector_id: base.sector_id,
      sector_name: base.sector_name,
      attacker_goal: base.attacker_goal,
      coverage_pct: allSectorCases.length ? Math.round((doneCount / allSectorCases.length) * 100) : 0,
      door_count: doors.length,
      case_count: allSectorCases.length,
      done_case_count: doneCount,
      hole_count_by_tier: sectorIndex === 0 ? { urgent: 1, important: 1, hardening: 0 } : sectorIndex === 1 ? { urgent: 0, important: 0, hardening: 2 } : { urgent: 0, important: 0, hardening: 0 },
      hole_count_by_tier_at_baseline: sectorIndex === 0 ? { urgent: 0, important: 1, hardening: 0 } : { urgent: 0, important: 0, hardening: sectorIndex === 1 ? 1 : 0 },
      doors,
    };
  });
  const pick = (status, limit) => allCases.filter((entry) => entry.theCase.status === status).slice(0, limit);
  return {
    export_format_version: 1,
    generated_at: GENERATED_AT,
    sectors,
    since_last_night: {
      baseline_generated_at: BASELINE_AT,
      explored_cases: [...pick("robust", 6), ...pick("fixed", 2)].map(({ sector_id, door_id, theCase }) => ({ sector_id, door_id, case_id: theCase.case_id, case_name: theCase.case_name, status: theCase.status })),
      stale_cases: pick("stale", 4).map(({ sector_id, door_id, theCase }) => ({ sector_id, door_id, case_id: theCase.case_id, case_name: theCase.case_name, stale_reason: theCase.stale_reason })),
      new_doors: sectors.flatMap((sector) => sector.doors.slice(-1).map((door) => ({ sector_id: sector.sector_id, door_id: door.door_id, door_name: door.door_name, door_kind: door.door_kind }))).slice(0, 2),
    },
  };
}
