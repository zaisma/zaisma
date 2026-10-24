import { describe, expect, it } from "vitest";
import { DatabaseError, GameServerError, OutsideCallError } from "@zaisma/game-server";

/**
 * A game server's code can run beside its own copy of these classes (Zaisma's sandbox bundles one), so
 * instanceof answers for any error with the class's name and a known code, and for nothing else.
 */

const copyOf = (name: string, code: string): Error => Object.assign(new Error("a copy"), { name, code });

describe("instanceof across copies of the error classes", () => {
  it("matches an error named like the class with one of its codes", () => {
    expect(copyOf("GameServerError", "bad_room_call") instanceof GameServerError).toBe(true);
    expect(copyOf("DatabaseError", "bad_sql") instanceof DatabaseError).toBe(true);
    expect(copyOf("OutsideCallError", "host_not_allowed") instanceof OutsideCallError).toBe(true);
  });

  it("does not match an unknown code, another class's name, or a plain error", () => {
    expect(copyOf("GameServerError", "nope") instanceof GameServerError).toBe(false);
    expect(copyOf("DatabaseError", "nope") instanceof DatabaseError).toBe(false);
    expect(copyOf("OutsideCallError", "nope") instanceof OutsideCallError).toBe(false);
    expect(copyOf("DatabaseError", "bad_room_call") instanceof GameServerError).toBe(false);
    expect(new Error("plain") instanceof GameServerError).toBe(false);
    expect(("GameServerError" as unknown) instanceof GameServerError).toBe(false);
  });
});
