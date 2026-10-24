import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyStateChanges, diffState, newStateTracker, stateSyncModuleSource, type StateChange } from "../../packages/game-server/src/internal.ts";

// State sync's diff and its two copies of applyStateChanges: the game server's, and the SDK's, which
// players' games use. One table of cases runs through both, so they can't drift apart.

const SDK = readFileSync(join(import.meta.dirname, "../../packages/sdk/zaisma.js"), "utf8");

/** The SDK's own applyStateChanges, taken from zaisma.js as it is. */
function sdkApplyStateChanges(): (state: unknown, changes: StateChange[]) => unknown {
  const start = SDK.indexOf("  function applyStateChanges(state, changes) {");
  const end = SDK.indexOf("\n  }\n", start);
  if (start === -1 || end === -1) throw new Error("zaisma.js has no applyStateChanges");
  return new Function(`${SDK.slice(start, end + 4)}\nreturn applyStateChanges;`)();
}

const CASES: [string, unknown, unknown][] = [
  ["the same", { a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }],
  ["a number changes deep inside", { bodies: { ana: { x: 1, y: 2 }, bo: { x: 5, y: 6 } } }, { bodies: { ana: { x: 1.5, y: 2 }, bo: { x: 5, y: 6 } } }],
  ["a key is added and another removed", { bodies: { ana: { x: 1 } }, round: 1 }, { bodies: { bo: { x: 2 } }, round: 1, winner: "bo" }],
  ["values become null, and null becomes values", { a: 1, b: null, c: { d: true } }, { a: null, b: { e: "text" }, c: null }],
  ["an array grows", { list: [1, 2] }, { list: [1, 2, 3] }],
  ["an array shrinks", { list: [{ id: 1 }, { id: 2 }, { id: 3 }] }, { list: [{ id: 1 }] }],
  ["an array changes in place", { list: [{ id: 1, hp: 10 }, { id: 2, hp: 7 }] }, { list: [{ id: 1, hp: 9 }, { id: 2, hp: 7 }] }],
  ["an object becomes an array", { slot: { a: 1 } }, { slot: [1] }],
  ["the whole state is replaced", { a: 1 }, [1, 2, 3]],
  ["from nothing", null, { a: { b: [1, { c: 2 }] } }],
  ["strings and booleans", { name: "Ana", isReady: false }, { name: "Ana Lima", isReady: true }],
  ["a key named __proto__ is data", { a: 1 }, JSON.parse('{"a":1,"__proto__":{"isAdmin":true}}')],
];

describe("state sync's diff", () => {
  const sdkApply = sdkApplyStateChanges();
  for (const [name, previous, next] of CASES) {
    it(`rebuilds the next state from the changes, in the game server and the SDK: ${name}`, () => {
      const before = JSON.stringify(previous);
      const changes = diffState(previous, next);
      // Changes cross the wire as JSON.
      const sent = JSON.parse(JSON.stringify(changes)) as StateChange[];
      for (const apply of [applyStateChanges, sdkApply]) {
        const rebuilt = apply(previous, sent);
        expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(next));
        expect(Object.getPrototypeOf(rebuilt ?? {})).not.toHaveProperty("isAdmin");
      }
      // The state it started from stays as it was: the SDK keeps earlier ones for smoothing.
      expect(JSON.stringify(previous)).toBe(before);
    });
  }

  it("sends only what changed: keys by key, arrays by index while their length stays, whole when it changes", () => {
    expect(diffState({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 2, d: 4 } })).toEqual([[["b", "d"], 4]]);
    expect(diffState({ a: 1, gone: true }, { a: 1 })).toEqual([[["gone"]]]);
    expect(diffState({ list: [1, 2, 3] }, { list: [1, 9, 3] })).toEqual([[["list", 1], 9]]);
    expect(diffState({ list: [1, 2] }, { list: [1, 2, 3] })).toEqual([[["list"], [1, 2, 3]]]);
    expect(diffState(1, 2)).toEqual([[[], 2]]);
  });

  it("runs the same in the sandbox's copy of the module", async () => {
    const module = await import(`data:text/javascript,${encodeURIComponent(stateSyncModuleSource())}`);
    for (const [, previous, next] of CASES) expect(module.default.diffState(previous, next)).toEqual(diffState(previous, next));
    const tracker = module.default.newStateTracker(1024);
    expect(tracker.round({ a: 1 }, ["ana"], null, new Set()).frames).toEqual([{ playerIds: ["ana"], frame: { full: { a: 1 } } }]);
  });
});

describe("state sync's tracker", () => {
  it("sends a full copy first, then what changed, once for every viewer who sees the same", () => {
    const tracker = newStateTracker(1024 * 1024);
    const state = { round: 1, scores: { ana: 0, bo: 0 } };
    expect(tracker.round(state, ["ana", "bo"], null, new Set()).frames).toEqual([{ playerIds: ["ana", "bo"], frame: { full: state } }]);
    state.scores.ana = 1;
    expect(tracker.round(state, ["ana", "bo"], null, new Set()).frames).toEqual([{ playerIds: ["ana", "bo"], frame: { changes: [[["scores", "ana"], 1]] } }]);
    // Nothing changed: nothing goes out.
    expect(tracker.round(state, ["ana", "bo"], null, new Set()).frames).toEqual([]);
    // A new viewer gets a full copy while the others get the changes.
    state.round = 2;
    expect(tracker.round(state, ["ana", "bo", "cy"], null, new Set()).frames).toEqual([
      { playerIds: ["ana", "bo"], frame: { changes: [[["round"], 2]] } },
      { playerIds: ["cy"], frame: { full: { round: 2, scores: { ana: 1, bo: 0 } } } },
    ]);
  });

  it("skips a backed-up viewer, then sends them a full copy", () => {
    const tracker = newStateTracker(1024 * 1024);
    const state = { tick: 1 };
    tracker.round(state, ["ana"], null, new Set());
    state.tick = 2;
    expect(tracker.round(state, ["ana"], null, new Set(["ana"])).frames).toEqual([]);
    state.tick = 3;
    expect(tracker.round(state, ["ana"], null, new Set()).frames).toEqual([{ playerIds: ["ana"], frame: { full: { tick: 3 } } }]);
  });

  it("doesn't send a view over the size it's given, and says so once", () => {
    const tracker = newStateTracker(100);
    const big = { text: "x".repeat(200) };
    const first = tracker.round(big, ["ana"], null, new Set());
    expect(first.frames).toEqual([]);
    expect(first.problems).toEqual([expect.stringContaining("Cut it to what each player needs with stateView")]);
    expect(tracker.round(big, ["ana"], null, new Set()).problems).toEqual([]);
  });

  it("says once a round that stateView threw, and sends the others theirs", () => {
    const tracker = newStateTracker(1024);
    const round = tracker.round({ a: 1 }, ["ana", "bo"], (viewerId) => {
      if (viewerId === "ana") throw new Error("no view");
      return { mine: viewerId };
    }, new Set());
    expect(round.frames).toEqual([{ playerIds: ["bo"], frame: { full: { mine: "bo" } } }]);
    expect(round.problems).toEqual([expect.stringContaining("stateView failed: Error: no view")]);
  });
});
