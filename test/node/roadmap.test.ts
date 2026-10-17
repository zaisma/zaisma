import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { currentPhase, findSlice, firstBlockers, isPersonSlice, LATER, parseRoadmap, phaseProgress, unknownNames, unsettledDoneSlices } from "../../scripts/roadmap.mjs";

/** docs/ROADMAP.md: Now's First and Next parts, the phases and their gates, and areas with their slices, as scripts/roadmap-slice.mjs reads them. */

const ROOT = join(import.meta.dirname, "../..");

type Slice = { name: string; status: string; phase: string; mustOrNice: string; area: { title: string } };
type Area = { title: string; goal: string; firstSliceNames: string[] };
type Phase = { name: string; gateSliceNames: string[] };

const SAMPLE = `# Roadmap

## Now

**First:**

1. Pass shape (Identity)

**Next:**

2. Friends list (Friends)
3. Party chat (Friends)

## Phases

### Phase 0: Alpha

**Goal:** hosting.

**Reached:** Oct 11, 2026, live.

### Phase 1: Beta

**Goal:** open to everyone.

**Gates:** Ready to invite.

### Later

Not a phase.

## How to read this

- **Areas** hold slices.

## Players

Who a player is.

### Identity

**Goal:** who a player is.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Alpha | Must | yes | Guest IDs | | |
| next | Beta | Must | | Pass shape | Guest IDs | |

### Friends

**Goal:** friends.

**First:** Friends list

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| next | Beta | Must | yes | Friends list | | |
| next | Beta | Must | | Party chat | | |
| planned | Beta | Nice | | Emotes | | |
| planned | Beta | Must | | Ready to invite | Friends list, Party chat | |
| planned | Later | Must | | Voice chat | Party chat | |

### Notifications

**Goal:** players hear what matters.

Nothing planned yet.
`;

describe("the roadmap's format", () => {
  const sample = parseRoadmap(SAMPLE);

  it("reads Now's First and Next parts with places counted straight through", () => {
    expect(sample.nowSlices).toEqual([
      { name: "Pass shape", part: "first" },
      { name: "Friends list", part: "next" },
      { name: "Party chat", part: "next" },
    ]);
  });

  it("reads groups, areas with their goals, and empty areas", () => {
    expect(sample.groups.map((group: { title: string; intro: string }) => [group.title, group.intro])).toEqual([["Players", "Who a player is."]]);
    expect(sample.areas.map((area: Area) => [area.title, area.goal])).toEqual([["Identity", "who a player is."], ["Friends", "friends."], ["Notifications", "players hear what matters."]]);
    expect(findSlice(sample, "Party chat")).toMatchObject({ group: "Players", phase: "Beta", status: "next", area: { title: "Friends" } });
  });

  it("reads the phases with when they were reached and their gates", () => {
    expect(sample.phases).toEqual([
      { number: 0, name: "Alpha", goal: "hosting.", reachedOn: "Oct 11, 2026", gateSliceNames: [] },
      { number: 1, name: "Beta", goal: "open to everyone.", reachedOn: "", gateSliceNames: ["Ready to invite"] },
    ]);
    expect(currentPhase(sample).name).toBe("Beta");
  });

  it("counts a phase's must slices, and a gate with everything it needs", () => {
    const passDone = parseRoadmap(SAMPLE.replace("| next | Beta | Must | yes | Friends list |", "| done | Beta | Must | yes | Friends list |"));
    expect(phaseProgress(passDone, currentPhase(passDone))).toEqual({
      mustDoneCount: 1, mustCount: 4,
      gates: [{ name: "Ready to invite", doneCount: 1, count: 3 }],
    });
  });

  it("holds every other slice until First in Now lands, but not the First slice itself", () => {
    expect(firstBlockers(sample, findSlice(sample, "Pass shape"))).toEqual([]);
    expect(firstBlockers(sample, findSlice(sample, "Emotes"))).toEqual([
      { name: "Pass shape", status: "next", gate: "now" },
      { name: "Friends list", status: "next", gate: "area" },
    ]);
  });

  it("holds an area's other slices until its First slice lands", () => {
    const passDone = parseRoadmap(SAMPLE.replace("| next | Beta | Must | | Pass shape |", "| done | Beta | Must | | Pass shape |"));
    expect(firstBlockers(passDone, findSlice(passDone, "Friends list"))).toEqual([]);
    expect(firstBlockers(passDone, findSlice(passDone, "Party chat"))).toEqual([{ name: "Friends list", status: "next", gate: "area" }]);
  });

  it("reads \"**First:** nothing.\" as no First slices", () => {
    const empty = parseRoadmap(SAMPLE.replace("**First:**\n\n1. Pass shape (Identity)", "**First:** nothing."));
    expect(empty.nowSlices.filter((entry: { part: string }) => entry.part === "first")).toEqual([]);
  });

  it("reads the Settled column", () => {
    expect(findSlice(sample, "Friends list").isSettled).toBe(true);
    expect(findSlice(sample, "Party chat").isSettled).toBe(false);
  });

  it("keeps Settled apart from status: a done slice that isn't settled isn't checked off, except a person's", () => {
    const built = parseRoadmap(SAMPLE
      .replace("| next | Beta | Must | yes | Friends list |", "| done | Beta | Must | yes | Friends list |")
      .replace("| next | Beta | Must | | Party chat |", "| done | Beta | Must | | Party chat |")
      .replace("| planned | Beta | Nice | | Emotes |", "| done | Beta | Nice | | Julius: buy emotes |"));
    expect(unsettledDoneSlices(built).map((slice: Slice) => slice.name)).toEqual(["Party chat"]);
  });

  it("still reads a slice's name and status from a file with the old Item column, for claims in other worktrees", () => {
    const old = parseRoadmap("## Phase 1: Beta\n\n### Social\n\n| Status | Must/Nice | Item | Needs | Notes |\n| --- | --- | --- | --- | --- |\n| doing | Must | Friends list | | |\n");
    expect(old.slices.map((slice: Slice) => [slice.name, slice.status])).toEqual([["Friends list", "doing"]]);
  });
});

describe("docs/ROADMAP.md", () => {
  const text = readFileSync(join(ROOT, "docs/ROADMAP.md"), "utf8");
  const roadmap = parseRoadmap(text);
  const phaseNames = [...roadmap.phases.map((phase: Phase) => phase.name), LATER];

  it("gives every table a Phase and a Settled column, Settled holding yes or nothing", () => {
    const cellsOf = (line: string) => line.slice(1, -1).split("|").map((cell) => cell.trim());
    const badLines: string[] = [];
    let settledColumn = -1;
    for (const line of text.split("\n")) {
      if (!line.startsWith("|")) { settledColumn = -1; continue; }
      if (line.startsWith("| Status |")) {
        const header = cellsOf(line);
        settledColumn = header.indexOf("Settled");
        if (settledColumn < 0 || !header.includes("Phase") || !header.includes("Slice")) badLines.push(line);
        continue;
      }
      const value = cellsOf(line)[settledColumn];
      if (settledColumn >= 0 && !/^\|[\s|-]+\|$/.test(line) && value !== "yes" && value !== "") badLines.push(line);
    }
    expect(badLines).toEqual([]);
  });

  it("names only real slices in Now, First, Gates and Needs, and keeps First slices unfinished", () => {
    expect(unknownNames(roadmap)).toEqual([]);
    const finishedFirst = roadmap.nowSlices
      .filter((entry: { part: string }) => entry.part === "first")
      .filter((entry: { name: string }) => findSlice(roadmap, entry.name)?.status === "done");
    expect(finishedFirst).toEqual([]);
    const finishedAreaFirst = roadmap.areas
      .flatMap((area: Area) => area.firstSliceNames)
      .filter((name: string) => findSlice(roadmap, name)?.status === "done");
    expect(finishedAreaFirst).toEqual([]);
  });

  it("puts every slice in a phase or Later, with a known status and Must or Nice", () => {
    const bad = roadmap.slices.filter((slice: Slice) =>
      !phaseNames.includes(slice.phase) ||
      !["done", "doing", "next", "planned", "idea"].includes(slice.status) ||
      (slice.status !== "idea" && !["Must", "Nice"].includes(slice.mustOrNice)));
    expect(bad.map((slice: Slice) => slice.name)).toEqual([]);
  });

  it("marks only Now's slices next, besides a person's slice that's waiting on them", () => {
    const inNow = new Set(roadmap.nowSlices.map((entry: { name: string }) => entry.name.toLowerCase()));
    const stray = roadmap.slices.filter((slice: Slice) => slice.status === "next" && !inNow.has(slice.name.toLowerCase()) && !isPersonSlice(slice));
    expect(stray.map((slice: Slice) => slice.name)).toEqual([]);
  });

  it("gives every area a goal and at most 30 slices, and every slice a name of its own with no commas", () => {
    expect(roadmap.areas.filter((area: Area) => !area.goal).map((area: Area) => area.title)).toEqual([]);
    const crowded = roadmap.areas.filter((area: Area) => roadmap.slices.filter((slice: Slice) => slice.area === area).length > 30);
    expect(crowded.map((area: Area) => area.title)).toEqual([]);
    const names = roadmap.slices.map((slice: Slice) => slice.name.toLowerCase());
    expect(names.filter((name: string, i: number) => names.indexOf(name) !== i)).toEqual([]);
    expect(roadmap.slices.filter((slice: Slice) => slice.name.includes(",")).map((slice: Slice) => slice.name)).toEqual([]);
  });

  it("has a current phase whose gates are real slices", () => {
    const phase = currentPhase(roadmap);
    expect(phase).toBeTruthy();
    for (const name of phase.gateSliceNames) expect(findSlice(roadmap, name)).toBeTruthy();
  });
});
