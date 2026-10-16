import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { findRow, firstBlockers, parseRoadmap, unknownNames } from "../../scripts/roadmap.mjs";

/** docs/ROADMAP.md: Now's First and Next parts, and a project's First line, as scripts/roadmap-item.mjs reads them. */

const ROOT = join(import.meta.dirname, "../..");

const SAMPLE = `# Roadmap

## Now

**First:**

1. Pass shape (Identity)

**Next:**

2. Friends list (Social)
3. Party chat (Social)

## Phase 1: Beta

### Identity

**Goal:** who a player is. **Done when:** every must row is done.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| next | Must | Pass shape | | |

### Social

**Goal:** friends. **Done when:** every must row is done.

**First:** Friends list

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| next | Must | Friends list | | |
| next | Must | Party chat | | |
| planned | Nice | Emotes | | |
`;

describe("the roadmap's First markers", () => {
  const sample = parseRoadmap(SAMPLE);

  it("reads Now's First and Next parts with places counted straight through", () => {
    expect(sample.nowItems).toEqual([
      { name: "Pass shape", part: "first" },
      { name: "Friends list", part: "next" },
      { name: "Party chat", part: "next" },
    ]);
  });

  it("holds every other item until First in Now lands, but not the First item itself", () => {
    expect(firstBlockers(sample, findRow(sample, "Pass shape"))).toEqual([]);
    expect(firstBlockers(sample, findRow(sample, "Emotes"))).toEqual([
      { name: "Pass shape", status: "next", gate: "now" },
      { name: "Friends list", status: "next", gate: "project" },
    ]);
  });

  it("holds a project's other rows until its First item lands", () => {
    const passDone = parseRoadmap(SAMPLE.replace("| next | Must | Pass shape |", "| done | Must | Pass shape |"));
    expect(firstBlockers(passDone, findRow(passDone, "Friends list"))).toEqual([]);
    expect(firstBlockers(passDone, findRow(passDone, "Party chat"))).toEqual([{ name: "Friends list", status: "next", gate: "project" }]);
  });

  it("reads \"**First:** nothing.\" as no First items", () => {
    const empty = parseRoadmap(SAMPLE.replace("**First:**\n\n1. Pass shape (Identity)", "**First:** nothing."));
    expect(empty.nowItems.filter((item: { part: string }) => item.part === "first")).toEqual([]);
  });

  it("names only real items in docs/ROADMAP.md, and keeps First items in Now unfinished", () => {
    const roadmap = parseRoadmap(readFileSync(join(ROOT, "docs/ROADMAP.md"), "utf8"));
    expect(unknownNames(roadmap)).toEqual([]);
    const finishedFirst = roadmap.nowItems
      .filter((item: { part: string }) => item.part === "first")
      .filter((item: { name: string }) => findRow(roadmap, item.name)?.status === "done");
    expect(finishedFirst).toEqual([]);
    const finishedProjectFirst = roadmap.projects
      .flatMap((project: { firstItemNames: string[] }) => project.firstItemNames)
      .filter((name: string) => findRow(roadmap, name)?.status === "done");
    expect(finishedProjectFirst).toEqual([]);
  });
});
