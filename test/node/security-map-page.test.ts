import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { buildDemoPage, buildPage, MAXIMUM_PAGE_BYTES } from "../../scripts/security-map/build-page.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { demoScenarios } from "../../scripts/security-map/page/demo-data.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { escapeHtml, summaryLineOf, thinLineOf } from "../../scripts/security-map/page/render.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { pageDataHashOf, pageDataOf, pageDataOfMapDir, shieldStateOf } from "../../scripts/security-map/page-data.mjs";
import {
  gateCountsOf,
  isGateOpen,
  publicPromisesStateOf,
  publishedPromisesInFile,
  publishedPromisesOf,
  unprintableLinesOf,
  withPublishedPromises,
  writePublicPromises,
  // @ts-expect-error: a plain JavaScript script without types
} from "../../scripts/security-map/public-promises.mjs";
import { temporaryFolder } from "../temporary-folder.ts";

/** The Security map page and the printed promises: the shield's rule, what reaches the page, and the gate. The look is judged in its preview. */

const ROOT = join(import.meta.dirname, "../..");
const CLI = join(ROOT, "scripts/security-map/cli.mjs");

const SCALES = {
  defense_steps: [1, 2, 3, 4, 5].map((step_score) => ({ step_score, step_example: `Lock words ${step_score}` })),
  damage_steps: [1, 2, 3, 4, 5].map((step_score) => ({ step_score, step_example: `Harm words ${step_score}` })),
};

const itemOf = (fields: Record<string, unknown> = {}) => ({
  item_id: "itm_2026-11-03_a",
  item_kind: "item",
  sector_id: "rooms",
  item_state: "next",
  defense_score: 4,
  damage_score: 1,
  calls: [],
  waits_on: [],
  item_line: "An item line.",
  goal_line: "A goal line.",
  defense_reason: "PLANTED_DEFENSE_REASON",
  damage_reason: "PLANTED_DAMAGE_REASON",
  proof_line: "PLANTED_PROOF_LINE",
  test_path: "PLANTED_TEST_PATH",
  finding_id: "fnd_PLANTED",
  anchors: [{ anchor_id: "PLANTED_ANCHOR" }],
  ...fields,
});

const promiseOf = (fields: Record<string, unknown> = {}) => ({
  sector_id: "rooms",
  rollout_position: 1,
  promise_line: "A promise line.",
  strengths: [{ strength_kind: "math", strength_line: "A strength line.", strength_reason: "PLANTED_STRENGTH_REASON", anchors: [], strength_stale_reason: null }],
  ways_to_break: [{ way_id: "a-way", way_line: "A way line.", defense_score: 3, damage_score: 5, defense_reason: "PLANTED_DEFENSE_REASON", damage_reason: "PLANTED_DAMAGE_REASON", anchors: [], score_stale_reason: null }],
  ...fields,
});

const dataOf = (items: unknown[], extra: Record<string, unknown> = {}) => pageDataOf({ scales: SCALES, promises: [promiseOf()], items, grid: null, patterns: null, lastReviewDate: "2026-11-03", ...extra });

describe("a shield", () => {
  it("follows its worst open item", () => {
    expect(shieldStateOf([])).toBe("whole");
    expect(shieldStateOf([itemOf({ defense_score: 4, damage_score: 2 })])).toBe("whole");
    expect(shieldStateOf([itemOf({ defense_score: 2, damage_score: 2 })])).toBe("cracked");
    expect(shieldStateOf([itemOf({ defense_score: 3, damage_score: 3 })])).toBe("chipped");
    expect(shieldStateOf([itemOf({ defense_score: 2, damage_score: 3 })])).toBe("torn");
    expect(shieldStateOf([itemOf({ defense_score: 2, damage_score: 2 }), itemOf({ defense_score: 1, damage_score: 5 }), itemOf({ defense_score: 3, damage_score: 3 })])).toBe("torn");
  });

  it("moves only for a proven, open item", () => {
    const fixNow = { defense_score: 1, damage_score: 5 };
    for (const item_state of ["done", "accepted", "closed_unproven"]) expect(shieldStateOf([itemOf({ ...fixNow, item_state })])).toBe("whole");
    expect(shieldStateOf([itemOf({ defense_score: 3, damage_score: 5, item_kind: "question" })])).toBe("whole");
    expect(shieldStateOf([itemOf({ ...fixNow, item_state: "doing" })])).toBe("torn");
  });

  it("is Zaisma's when it's a sector's worst, and leaves the other sectors alone", () => {
    const data = pageDataOf({ scales: SCALES, promises: [promiseOf(), promiseOf({ sector_id: "money", rollout_position: 2 })], items: [itemOf({ defense_score: 1, damage_score: 5 })], grid: null, patterns: null, lastReviewDate: null });
    expect(data.shield_state).toBe("torn");
    expect(data.sectors.map((sector: { shield_state: string }) => sector.shield_state)).toEqual(["torn", "whole"]);
  });

  it("isn't moved by grid failures, pattern findings or changed code, which are counted instead", () => {
    const stale = promiseOf({ ways_to_break: [{ way_id: "a-way", way_line: "A way line.", defense_score: 3, damage_score: 5, anchors: [], score_stale_reason: "changed" }] });
    const data = dataOf([], { promises: [stale], grid: { failures: [{}, {}], doors_not_tried: [{}] }, patterns: { findings: [{}] } });
    expect(data.shield_state).toBe("whole");
    expect(data.work_ahead).toMatchObject({ grid_failure_count: 3, pattern_finding_count: 1, changed_code_count: 1 });
    expect(data.ahead_count).toBe(4);
  });
});

describe("what needs attention", () => {
  it("is worst first, leaves watch items out, and says where each stands", () => {
    const data = dataOf([
      itemOf({ item_id: "itm_soon", defense_score: 2, damage_score: 1 }),
      itemOf({ item_id: "itm_watch", defense_score: 5, damage_score: 1 }),
      itemOf({ item_id: "itm_harden", defense_score: 4, damage_score: 5, calls: ["A call."] }),
      itemOf({ item_id: "itm_now", defense_score: 1, damage_score: 3, item_state: "doing" }),
      itemOf({ item_id: "itm_wait", defense_score: 3, damage_score: 3, waits_on: ["Another slice"] }),
    ]);
    expect(data.attention_items.map((item: { shield_state: string; item_standing: string }) => [item.shield_state, item.item_standing])).toEqual([
      ["torn", "being_fixed"],
      ["chipped", "waits_on_your_call"],
      ["chipped", "waits_on_other_work"],
      ["cracked", "up_next"],
    ]);
    expect(data.attention_count).toBe(4);
    expect(data.work_ahead.watch_count).toBe(1);
  });

  it("reads plainly at each count", () => {
    expect(summaryLineOf({ attention_count: 0, ahead_count: 0 })).toBe("Nothing needs attention.");
    expect(summaryLineOf({ attention_count: 0, ahead_count: 1 })).toBe("Nothing needs attention. 1 item ahead.");
    expect(summaryLineOf({ attention_count: 1, ahead_count: 14 })).toBe("1 needs attention, 14 items ahead.");
    expect(summaryLineOf({ attention_count: 2, ahead_count: 0 })).toBe("2 need attention.");
  });
});

describe("the thin spots", () => {
  const wayOf = (way_id: string, defense_score: number, damage_score: number) => ({ way_id, way_line: `Way ${way_id}.`, defense_score, damage_score, defense_reason: "PLANTED_DEFENSE_REASON", damage_reason: "PLANTED_DAMAGE_REASON", anchors: [], score_stale_reason: null });
  const promises = [
    promiseOf({ ways_to_break: [wayOf("far", 3, 4), wayOf("open", 1, 5), wayOf("vault", 4, 5), wayOf("near", 3, 3)] }),
    promiseOf({ sector_id: "money", rollout_position: 2, ways_to_break: [wayOf("money", 3, 5)] }),
  ];
  const thinOf = (items: unknown[]) => dataOf(items, { promises }).thin_ways.map((way: { way_line: string }) => way.way_line);

  it("are the ways reaching many games or money past one lock or less, worst harm first, then the weakest lock", () => {
    expect(thinOf([])).toEqual(["Way open.", "Way money.", "Way far."]);
    expect(dataOf([], { promises }).work_ahead.thin_way_count).toBe(3);
  });

  it("leave the list only for a proven, open item on that way at its full weight", () => {
    const onMoney = (fields: Record<string, unknown>) => itemOf({ sector_id: "money", way_id: "money", defense_score: 3, damage_score: 5, ...fields });
    expect(thinOf([onMoney({})])).toEqual(["Way open.", "Way far."]);
    expect(thinOf([onMoney({ defense_score: 5, damage_score: 2 })])).toContain("Way money.");
    expect(thinOf([onMoney({ item_kind: "question" })])).toContain("Way money.");
    expect(thinOf([onMoney({ item_state: "done" })])).toContain("Way money.");
    expect(thinOf([onMoney({ sector_id: "rooms" })])).toContain("Way money.");
  });

  it("never move a shield or the summary, and carry only the way's line and its steps", () => {
    const data = dataOf([], { promises });
    expect(data.shield_state).toBe("whole");
    expect(data.ahead_count).toBe(0);
    expect(data.thin_ways[0]).toEqual({ sector_id: "rooms", sector_name: expect.any(String), way_line: "Way open.", harm_level: "everyone", harm_line: "Harm words 5", lock_level: "open", lock_line: "Lock words 1" });
  });

  it("show under the shield as a line and a list, and not at all when there are none", () => {
    const html: string = buildPage(dataOf([], { promises }));
    expect(html).toContain(thinLineOf(3));
    expect(html).toContain("Behind one lock");
    expect(html).toContain("Way far.");
    expect(html).not.toContain("PLANTED");
    expect(thinLineOf(1)).toBe("1 way to break would reach many games or money past one lock.");
    const none = buildPage(dataOf([], { promises: [promiseOf({ ways_to_break: [wayOf("near", 3, 3)] })] }));
    expect(none).not.toContain("Behind one lock");
    expect(none).not.toContain("past one lock");
  });
});

describe("the built page", () => {
  it("carries only the named fields: no reason, anchor, proof, finding or score reaches it", () => {
    const html: string = buildPage(dataOf([itemOf({ defense_score: 1, damage_score: 5 })]));
    expect(html).toContain("An item line.");
    expect(html).toContain("A promise line.");
    expect(html).toContain("A way line.");
    expect(html).not.toContain("PLANTED");
    expect(html).not.toMatch(/fnd_|itm_|defense|damage|score/i);
  });

  it("escapes every value and holds no script, so a line can't become markup", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    const html: string = buildPage(dataOf([itemOf({ defense_score: 1, damage_score: 5, item_line: "<script>alert(1)</script>" })]));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    for (const page of [html, buildDemoPage()]) {
      expect(page).not.toMatch(/<script/i);
      expect(page).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
      expect(page.startsWith("<title>Zaisma Security Map</title>")).toBe(true);
    }
  });

  it("holds each shield in a box starting at 0 0, so it sits centered with nothing cut off", () => {
    const html: string = buildDemoPage();
    const holders = [...html.matchAll(/<svg class="shield" viewBox="([^"]+)"/g)].map((match) => match[1]);
    expect(holders.length).toBeGreaterThan(0);
    expect(new Set(holders)).toEqual(new Set(["0 0 128 126"]));
    expect(html).toContain('<symbol id="shield-torn" viewBox="-14 -8 128 126">');
  });

  it("has a drawing for every shield it uses, with each sector's emblem in every state", () => {
    const html: string = buildDemoPage();
    const used = [...html.matchAll(/<use href="#(shield-(?:whole|cracked|chipped|torn)[^"]*)"/g)].map((match) => match[1]);
    expect(used).toContain("shield-torn-player-data");
    expect(used).toContain("shield-torn-zaisma");
    const markPaths = readFileSync(join(ROOT, "brand/zaisma-mark-white.svg"), "utf8").match(/<path [^>]*\/>/g)!;
    for (const path of markPaths) expect(html).toContain(path);
    for (const symbolId of used) expect(html).toContain(`<symbol id="${symbolId}"`);
    for (const state of ["whole", "cracked", "chipped", "torn"]) for (const sector of demoScenarios()[0].page_data.sectors) expect(html).toContain(`<symbol id="shield-${state}-${sector.sector_id}"`);
    for (const sector of demoScenarios()[0].page_data.sectors) expect(html).toContain(`<g id="emblem-${sector.sector_id}">`);
  });

  it("shows no attention section when nothing needs it", () => {
    expect(buildPage(dataOf([]))).not.toContain("Needs attention first");
    expect(buildPage(dataOf([itemOf({ defense_score: 2, damage_score: 1 })]))).toContain("Needs attention first");
  });

  it("has a demo of each state he judges, within the size limit, with ids that don't repeat", () => {
    const scenarios = demoScenarios();
    const statesOf = (scenarioId: string) => scenarios.find((scenario: { scenario_id: string }) => scenario.scenario_id === scenarioId).page_data.sectors.map((sector: { shield_state: string }) => sector.shield_state);
    expect(new Set(statesOf("whole"))).toEqual(new Set(["whole"]));
    expect(new Set(statesOf("broken"))).toEqual(new Set(["whole", "cracked", "chipped", "torn"]));
    expect(scenarios.find((scenario: { scenario_id: string }) => scenario.scenario_id === "nothing").page_data.attention_count).toBe(0);
    expect(scenarios.find((scenario: { scenario_id: string }) => scenario.scenario_id === "nothing").page_data.thin_ways).toEqual([]);
    expect(scenarios.find((scenario: { scenario_id: string }) => scenario.scenario_id === "whole").page_data.thin_ways.length).toBeGreaterThan(0);
    expect(scenarios.find((scenario: { scenario_id: string }) => scenario.scenario_id === "many").page_data.attention_count).toBeGreaterThan(30);
    const html: string = buildDemoPage();
    expect(Buffer.byteLength(html)).toBeLessThan(MAXIMUM_PAGE_BYTES);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is hashed so the hash moves exactly when the page would", () => {
    expect(pageDataHashOf(dataOf([]))).toBe(pageDataHashOf(dataOf([])));
    expect(pageDataHashOf(dataOf([]))).not.toBe(pageDataHashOf(dataOf([itemOf()])));
  });
});

describe("the printed promises", () => {
  const clear = { promises: [promiseOf()], items: [], grid: { failures: [], doors_not_tried: [] }, patterns: { findings: [] } };
  const EMPTY_FILE = "// A note.\n\nexport const PUBLISHED_PROMISES: PublishedPromise[] = [];\n";

  it("open only with every shield whole and the grid, patterns and scores clear", () => {
    expect(isGateOpen(gateCountsOf(clear))).toBe(true);
    expect(isGateOpen(gateCountsOf({ ...clear, items: [itemOf({ defense_score: 4, damage_score: 1 })] }))).toBe(true);
    const closedBy = [
      { items: [itemOf({ defense_score: 2, damage_score: 1 })] },
      { grid: null },
      { grid: { failures: [{}], doors_not_tried: [] } },
      { grid: { failures: [], doors_not_tried: [{}] } },
      { patterns: null },
      { patterns: { findings: [{}] } },
      { promises: [promiseOf({ strengths: [{ strength_kind: "math", strength_line: "A line.", strength_stale_reason: "changed" }] })] },
    ];
    for (const change of closedBy) expect(isGateOpen(gateCountsOf({ ...clear, ...change }))).toBe(false);
  });

  it("hold only the lines, in rollout order", () => {
    const list = publishedPromisesOf([promiseOf({ sector_id: "money", rollout_position: 2, promise_line: "Second." }), promiseOf()]);
    expect(list.map((promise: { promise_line: string }) => promise.promise_line)).toEqual(["A promise line.", "Second."]);
    expect(list[1]).toEqual({ promise_line: "Second.", strengths: [{ strength_kind: "math", strength_line: "A strength line." }], way_lines: ["A way line."] });
    expect(JSON.stringify(list)).not.toContain("PLANTED");
  });

  it("refuse a line holding code, an address or a person", () => {
    const lineOf = (way_line: string) => unprintableLinesOf([{ promise_line: "Fine.", strengths: [], way_lines: [way_line] }]);
    expect(lineOf("Someone steals a player's pass.")).toEqual([]);
    for (const line of ["A bug in /v1/pass.", "A bug in `checkPass`.", "A bug in player_saves.", "See https://zaisma.com.", "Julius's logins."]) expect(lineOf(line)).toEqual([line]);
  });

  it("stay up once printed: a later item changes nothing, and only words update", () => {
    const printed = publishedPromisesOf(clear.promises);
    const withCrack = { ...clear, items: [itemOf({ defense_score: 1, damage_score: 5 })] };
    expect(publicPromisesStateOf(clear, [])).toMatchObject({ is_gate_open: true, is_published: false, next_step: "print" });
    expect(publicPromisesStateOf(withCrack, [])).toMatchObject({ is_gate_open: false, next_step: null });
    expect(publicPromisesStateOf(withCrack, printed)).toMatchObject({ is_gate_open: false, is_published: true, are_words_different: false, next_step: null });
    expect(publicPromisesStateOf({ ...withCrack, promises: [promiseOf({ promise_line: "Reworded." })] }, printed)).toMatchObject({ next_step: "update_words" });
  });

  it("round-trip through their file, keeping what's above the list", () => {
    const list = publishedPromisesOf(clear.promises);
    const text = withPublishedPromises(EMPTY_FILE, list);
    expect(text.startsWith("// A note.\n")).toBe(true);
    expect(publishedPromisesInFile(text)).toEqual(list);
    expect(publishedPromisesInFile(readFileSync(join(ROOT, "apps/site/src/security-promises.ts"), "utf8"))).toBeInstanceOf(Array);
    expect(() => publishedPromisesInFile("no list")).toThrow(/lost its list/);
  });

  describe("written from a private repo", () => {
    let mapDir = "";
    let filePath = "";
    beforeEach(() => {
      mapDir = temporaryFolder("security-promises-");
      filePath = join(mapDir, "security-promises.ts");
      writeFileSync(filePath, EMPTY_FILE);
      mkdirSync(join(mapDir, "promises"));
      writeFileSync(join(mapDir, "promises", "scales.json"), JSON.stringify(SCALES));
      writeFileSync(join(mapDir, "promises", "rooms.json"), JSON.stringify(promiseOf()));
    });
    afterEach(() => rmSync(mapDir, { recursive: true, force: true }));

    it("refuses with counts while the gate is closed, then writes once it opens", () => {
      expect(pageDataOfMapDir(mapDir)).toMatchObject({ shield_state: "whole" });
      expect(() => writePublicPromises({ mapDir, filePath })).toThrow(/Not printing the promises yet: .*"is_grid_run":false/);
      expect(readFileSync(filePath, "utf8")).toBe(EMPTY_FILE);
      mkdirSync(join(mapDir, "grid"));
      writeFileSync(join(mapDir, "grid", "failures.json"), JSON.stringify({ failures: [], doors_not_tried: [] }));
      mkdirSync(join(mapDir, "patterns"));
      writeFileSync(join(mapDir, "patterns", "findings.json"), JSON.stringify({ findings: [] }));
      expect(writePublicPromises({ mapDir, filePath })).toEqual({ promise_count: 1, is_first_printing: true });
      expect(publishedPromisesInFile(readFileSync(filePath, "utf8"))).toHaveLength(1);
      writeFileSync(join(mapDir, "grid", "failures.json"), JSON.stringify({ failures: [{}], doors_not_tried: [] }));
      expect(writePublicPromises({ mapDir, filePath })).toEqual({ promise_count: 1, is_first_printing: false });
    });
  });
});

describe("the CLI", () => {
  let workDir = "";
  beforeEach(() => {
    workDir = temporaryFolder("security-map-page-");
  });
  afterEach(() => rmSync(workDir, { recursive: true, force: true }));

  it("asks where to write and refuses the repos", () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [CLI, "page", ...args], { encoding: "utf8" });
    const missingOut = run("--map-dir", workDir);
    expect(missingOut.status).toBe(1);
    expect(missingOut.stderr).toContain("page needs --out <path>");
    const inRepo = run("--demo", "--map-dir", workDir, "--out", join(ROOT, "docs/security-map-test.html"));
    expect(inRepo.status).toBe(1);
    expect(inRepo.stderr).toContain("Write the page outside the repos");
    const outsideDir = temporaryFolder("security-map-out-");
    const built = run("--demo", "--map-dir", workDir, "--out", join(outsideDir, "p.html"));
    expect(built.status, built.stderr).toBe(0);
    expect(readFileSync(join(outsideDir, "p.html"), "utf8").startsWith("<title>Zaisma Security Map</title>")).toBe(true);
    const nothingToDraw = run("--map-dir", workDir, "--out", join(outsideDir, "q.html"));
    expect(nothingToDraw.status).toBe(1);
    expect(nothingToDraw.stderr).toContain("no promises yet");
    rmSync(outsideDir, { recursive: true, force: true });
  });
});
