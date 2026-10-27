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

  it("DEVELOPER-API's close code table lists every close code the code uses, and the runner's restart", () => {
    const doc = read("docs/DEVELOPER-API.md");
    const table = doc.slice(doc.indexOf("### Close codes"), doc.indexOf("### Room events"));
    const listed = [...table.matchAll(/^\| `(\d+)` \|/gm)].map((row) => Number(row[1]));
    const source = read("packages/game-server/src/room.ts");
    const used = [...source.matchAll(/^export const [A-Z_]+_CLOSE_CODE = (\d+);/gm)].map((match) => Number(match[1]));
    expect(used.length).toBeGreaterThan(4);
    expect(listed.sort()).toEqual([...used, 1012].sort());
  });
});

describe("the game server's options, runner flags and imports in the docs", () => {
  const docs = ["README.md", "docs/DEVELOPER-API.md", "docs/NAMING.md", "packages/game-server/README.md"].map((file) => ({ file, text: read(file) }));

  it("name every game server option", () => {
    const options = read("packages/game-server/src/room.ts").match(/export const GAME_SERVER_OPTIONS = \[([^\]]+)\]/)![1]!.match(/"(\w+)"/g)!.map((option) => option.slice(1, -1));
    expect(options.length).toBeGreaterThan(20);
    const text = docs.map((doc) => doc.text).join("\n");
    expect(options.filter((option) => !new RegExp(`\\b${option}\\b`).test(text))).toEqual([]);
  });

  it("give the Node runner only the flags it takes", () => {
    const flags = read("packages/game-server/bin/node.js").match(/const FLAGS = \[([^\]]+)\]/)![1]!.match(/"([a-z-]+)"/g)!.map((flag) => `--${flag.slice(1, -1)}`);
    let flagCount = 0;
    for (const { file, text } of docs) {
      // The flags in the clause that names the runner; the upload command's rows are its own (cli.test.ts holds those).
      const clauses = [...text.matchAll(/(?:npx @zaisma\/game-server|Node runner)[^;\n]*?(?=; |\. |\n|$)/g)].filter((match) => !text.slice(text.lastIndexOf("\n", match.index) + 1).startsWith("| `zaisma "));
      for (const flag of clauses.flatMap((clause) => clause[0].match(/--[a-z][a-z-]+/g) ?? [])) expect(flags, `${file} ${flag}`).toContain(flag);
      flagCount += clauses.flatMap((clause) => clause[0].match(/--[a-z][a-z-]+/g) ?? []).length;
    }
    expect(flagCount).toBeGreaterThan(3);
  });

  it("import only what the package exports", () => {
    const exported = { "@zaisma/game-server": read("packages/game-server/src/index.ts"), "@zaisma/game-server/node": read("packages/game-server/bin/node.d.ts") };
    for (const { file, text } of docs) {
      for (const match of text.matchAll(/import \{([^}]+)\} from "(@zaisma\/game-server(?:\/node)?)"/g)) {
        for (const name of match[1]!.split(",").map((part) => part.replace(/^\s*type\s+/, "").trim()).filter(Boolean)) expect(exported[match[2] as keyof typeof exported], `${file} ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
      }
    }
  });
});
