import { describe, expect, it } from "vitest";
import { lostSince, type Surface } from "./surface.ts";

describe("the v1 locks", () => {
  const was: Record<string, Surface> = {
    Event: { kind: "fields", fields: { id: ": string", kind: ': "a" | "b" | (string & {})', note: "?: string" } },
    Code: { kind: "values", values: ["bad", "old"] },
    LIMITS: { kind: "constant", value: { sizeBytes: 10 } },
    check: { kind: "signature", signature: "(text: string): boolean" },
  };

  it("let a contract gain fields, values and names", () => {
    const grown: Record<string, Surface> = {
      ...was,
      Event: { kind: "fields", fields: { id: ": string", kind: ': "a" | "b" | "c" | (string & {})', note: "?: string", extra: ": number" } },
      Code: { kind: "values", values: ["bad", "new", "old"] },
      Other: { kind: "values", values: ["x"] },
    };
    expect(lostSince(was, grown)).toEqual([]);
  });

  it("catch everything a contract loses or changes", () => {
    const shrunk: Record<string, Surface> = {
      Event: { kind: "fields", fields: { id: ": number", kind: ': "a" | (string & {})', note: ": string" } },
      Code: { kind: "values", values: ["bad"] },
      LIMITS: { kind: "constant", value: { sizeBytes: 5 } },
    };
    expect(lostSince(was, shrunk)).toEqual([
      'Event.id was : string, now : number',
      'Event.kind was : "a" | "b" | (string & {}), now : "a" | (string & {})',
      "Event.note was ?: string, now : string",
      "Code lost old",
      'LIMITS was {"kind":"constant","value":{"sizeBytes":10}}, now {"kind":"constant","value":{"sizeBytes":5}}',
      "check is gone",
    ]);
  });

  describe("on constants", () => {
    const limits = (value: Record<string, unknown>): Record<string, Surface> => ({ LIMITS: { kind: "constant", value } });
    const base = { maximumPlayerCount: 100, minimumIdleTimeoutSec: 30, defaultIdleTimeoutSec: 600, hiddenTimeoutSec: 60, nested: { maximumSizeBytes: 10 } };

    it("let a maximum rise, a minimum fall, and a key be added", () => {
      expect(lostSince(limits(base), limits({ ...base, maximumPlayerCount: 200, minimumIdleTimeoutSec: 10, added: 1 }))).toEqual([]);
      expect(lostSince(limits(base), limits({ ...base, nested: { maximumSizeBytes: 20 } }))).toEqual([]);
      expect(lostSince(limits(base), limits(base))).toEqual([]);
    });

    it("lose a maximum that falls, a minimum that rises, a default that changes, a plain key that changes and a key that goes", () => {
      const lostWith = (changed: Record<string, unknown>) => lostSince(limits(base), limits({ ...base, ...changed }));
      expect(lostWith({ maximumPlayerCount: 50 })).toHaveLength(1);
      expect(lostWith({ minimumIdleTimeoutSec: 60 })).toHaveLength(1);
      expect(lostWith({ defaultIdleTimeoutSec: 300 })).toHaveLength(1);
      expect(lostWith({ defaultIdleTimeoutSec: 900 })).toHaveLength(1);
      expect(lostWith({ hiddenTimeoutSec: 90 })).toHaveLength(1);
      expect(lostWith({ nested: { maximumSizeBytes: 5 } })).toHaveLength(1);
      const { hiddenTimeoutSec: _removed, ...withoutKey } = base;
      expect(lostSince(limits(base), limits(withoutKey))).toHaveLength(1);
    });
  });
});
