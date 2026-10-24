import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The error codes the docs list for the game server's rooms and requests are exactly the codes
 * the code has: a code added to RoomErrorCode or RequestErrorCode is listed in the README, and
 * docs/NAMING.md, or this fails.
 */

const ROOT = join(import.meta.dirname, "../..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

/** The string members of `export type <name> = | "a" | "b";`. */
function codesOf(file: string, name: string): string[] {
  const source = read(file);
  const start = source.indexOf(`export type ${name} =`);
  const body = source.slice(start, source.indexOf(";", start));
  return [...body.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
}

/** The backticked codes in a list that starts at `marker` and ends at the first full stop followed by a space or the end of the line. */
function listedAfter(text: string, marker: string): string[] {
  const start = text.indexOf(marker);
  expect(start, `"${marker}" in the doc`).toBeGreaterThan(-1);
  const rest = text.slice(start + marker.length);
  const end = rest.search(/\.(\s|$)/);
  return [...rest.slice(0, end).matchAll(/`([a-z_]+)`/g)].map((match) => match[1]!);
}

describe("game server error codes in the docs", () => {
  const roomCodes = codesOf("packages/game-server/src/room.ts", "RoomErrorCode");
  const requestCodes = codesOf("packages/game-server/src/requests.ts", "RequestErrorCode");

  it("find the codes in the source", () => {
    expect(roomCodes.length).toBeGreaterThan(10);
    expect(requestCodes).toHaveLength(12);
  });

  it("README lists every room error code and nothing else", () => {
    const listed = listedAfter(read("README.md"), "with codes in lowercase snake_case, one of: ");
    expect([...listed].sort()).toEqual([...roomCodes].sort());
  });

  it("README lists every request error code and nothing else", () => {
    const listed = listedAfter(read("README.md"), "`error.code`, one of: ");
    expect([...listed].sort()).toEqual([...requestCodes].sort());
  });

  it("NAMING lists every request error code and nothing else", () => {
    const row = read("docs/NAMING.md")
      .split("\n")
      .find((line) => line.includes("`RequestErrorCode`:"))!;
    const listed = [...row.slice(row.indexOf("`RequestErrorCode`:") + "`RequestErrorCode`:".length).matchAll(/`([a-z_]+)`/g)].map((match) => match[1]!);
    expect([...listed].sort()).toEqual([...requestCodes].sort());
  });
});
