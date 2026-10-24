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
});
