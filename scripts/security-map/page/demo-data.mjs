import { pageDataOf } from "../page-data.mjs";
import { SECTORS } from "../schema.mjs";

/**
 * Made-up records for judging the page's look: a --demo build reads no private repo. Every line here is
 * invented for the demo and describes nothing about Zaisma.
 */

const DEMO_SCALES = {
  defense_steps: ["Anyone can", "Any account", "A stolen session", "A stolen key and more", "Zaisma's own keys"].map((step_example, index) => ({ step_score: index + 1, step_example })),
  damage_steps: ["One player", "A few", "One game's players", "Many games", "Everyone, or money"].map((step_example, index) => ({ step_score: index + 1, step_example })),
};

const demoWay = (sectorId, index, defense_score, damage_score) => ({ way_id: `${sectorId}-way-${index}`, way_line: `Sample way ${index} this promise could break, in a plain sentence.`, defense_score, damage_score, score_stale_reason: null });

const DEMO_PROMISES = SECTORS.map(({ sector_id, sector_name }, index) => ({
  sector_id,
  rollout_position: index + 1,
  promise_line: `Sample promise for ${sector_name.toLowerCase()}: only the right person reaches it, in one line.`,
  strengths: [
    { strength_kind: "math", strength_line: "A sample signature that can't be forged.", strength_stale_reason: null },
    { strength_kind: "structure", strength_line: "A sample check that every call goes through.", strength_stale_reason: null },
    { strength_kind: "tested", strength_line: "Sample tests on every merge.", strength_stale_reason: null },
    { strength_kind: "trusted", strength_line: "A sample service kept by someone else.", strength_stale_reason: null },
  ],
  ways_to_break: [demoWay(sector_id, 1, 3, 1), demoWay(sector_id, 2, 4, 3), demoWay(sector_id, 3, 5, 5)],
}));

function demoItem(sector_id, itemNumber, { defense_score, damage_score, item_state = "next", item_kind = "item", calls = [], waits_on = [] }) {
  return {
    item_id: `itm_demo_${itemNumber}`,
    item_kind,
    sector_id,
    item_state,
    defense_score,
    damage_score,
    calls,
    waits_on,
    item_line: `Sample item ${itemNumber}: a sample door answers a caller it should refuse.`,
    goal_line: "After this, the sample door answers only its owner.",
  };
}

const EACH_BROKEN_ITEMS = [
  demoItem("player-data", 1, { defense_score: 1, damage_score: 4, item_state: "doing" }),
  demoItem("money", 2, { defense_score: 4, damage_score: 5, calls: ["A sample call."] }),
  demoItem("rooms", 3, { defense_score: 2, damage_score: 1 }),
];

const WATCH_ITEMS = [demoItem("rooms", 4, { defense_score: 4, damage_score: 2 }), demoItem("accounts", 5, { defense_score: 5, damage_score: 1 })];

function manyItems() {
  const shapes = [{ defense_score: 2, damage_score: 2 }, { defense_score: 3, damage_score: 4 }, { defense_score: 4, damage_score: 3 }, { defense_score: 1, damage_score: 2 }, { defense_score: 4, damage_score: 1 }];
  return Array.from({ length: 60 }, (_, index) => demoItem(SECTORS[index % SECTORS.length].sector_id, index + 10, shapes[index % shapes.length]));
}

const dataOf = (items, extra = {}) => pageDataOf({ scales: DEMO_SCALES, promises: DEMO_PROMISES, items, grid: null, patterns: null, lastReviewDate: "2026-11-03", ...extra });

/** The states to judge: every shield whole, one sector in each broken state, nothing needing attention, and many items ahead. */
export const demoScenarios = () => [
  { scenario_id: "whole", scenario_name: "Every shield whole", page_data: dataOf(WATCH_ITEMS) },
  { scenario_id: "broken", scenario_name: "Cracked, chipped, torn", page_data: dataOf(EACH_BROKEN_ITEMS) },
  { scenario_id: "nothing", scenario_name: "Nothing at all", page_data: dataOf([]) },
  { scenario_id: "many", scenario_name: "Many items ahead", page_data: dataOf(manyItems(), { grid: { failures: [{}, {}, {}], doors_not_tried: [] }, patterns: { findings: Array.from({ length: 35 }, () => ({})) } }) },
];
