import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_TEXT } from "../../packages/game-server/src/room.ts";
import { ADMIN_ERROR_CODES, ERROR_CODES } from "../../packages/core/src/errors.ts";
import { ALLOWED_CONTENT, CONTENT_RULES, INTERNAL_FINDING_CODES, NOTICE_CODES, REVIEW_CODES } from "../../packages/core/src/review.ts";
import { JUDGE_FINDING_CODES } from "../../apps/site/src/review-judge.ts";

/**
 * docs/NAMING.md, Errors: one list of codes. Every code in ERROR_CODES is listed in
 * docs/DEVELOPER-API.md with its HTTP status and meaning, and every one in ADMIN_ERROR_CODES in
 * docs/ADMIN-MCP.md; nothing else is listed there, and every code is one the code can answer with.
 */

const ROOT = join(import.meta.dirname, "../..");

/** The rows of a doc's Errors section's tables: | `code` | HTTP | Meaning |. */
function listedCodes(file: string, nextHeading: string): { code: string; httpStatus: number; meaning: string }[] {
  const doc = readFileSync(join(ROOT, file), "utf8");
  const section = doc.slice(doc.indexOf("\n## Errors\n"), doc.indexOf(`\n## ${nextHeading}\n`));
  return [...section.matchAll(/^\| `([a-z0-9_]+)` \| (\d+) \| (.+) \|$/gm)].map((row) => ({ code: row[1]!, httpStatus: Number(row[2]), meaning: row[3]! }));
}

/** Zaisma's own source that can answer with an error, without the list itself: the game database's codes come from rooms and the game server package. */
function source(): string {
  const read = (directory: string): string[] =>
    readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? read(join(directory, entry.name)) : entry.name.endsWith(".ts") && entry.name !== "errors.ts" ? [readFileSync(join(ROOT, directory, entry.name), "utf8")] : [],
    );
  return [...read("apps/site/src"), ...read("packages/core/src"), ...read("apps/rooms/src"), ...read("packages/game-server/src")].join("\n");
}

describe("error codes", () => {
  const everyCode = [...Object.keys(ERROR_CODES), ...Object.keys(ADMIN_ERROR_CODES)];

  it("are lowercase snake_case, and each in one list", () => {
    for (const code of everyCode) expect(code).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    expect(new Set(everyCode).size).toBe(everyCode.length);
  });

  it("are all listed in docs/DEVELOPER-API.md, as the code has them", () => {
    const listed = listedCodes("docs/DEVELOPER-API.md", "Next steps");
    expect(listed.map((row) => row.code)).toEqual(Object.keys(ERROR_CODES));
    for (const row of listed) expect(row, row.code).toEqual({ code: row.code, ...ERROR_CODES[row.code as keyof typeof ERROR_CODES] });
  });

  it("the admin MCP's own are all listed in docs/ADMIN-MCP.md, as the code has them", () => {
    const listed = listedCodes("docs/ADMIN-MCP.md", "Connect Claude Code");
    expect(listed.map((row) => row.code)).toEqual(Object.keys(ADMIN_ERROR_CODES));
    for (const row of listed) expect(row, row.code).toEqual({ code: row.code, ...ADMIN_ERROR_CODES[row.code as keyof typeof ADMIN_ERROR_CODES] });
  });

  it("are each one the code can answer with", () => {
    const code = source();
    // bad_<field> codes made from the field's name: the field is given where its value is checked.
    const isUsed = (errorCode: string) =>
      code.includes(`"${errorCode}"`) || (errorCode.startsWith("bad_") && new RegExp(`(oneOf|refuse)\\("${errorCode.slice(4)}"|\\["${errorCode.slice(4)}", |field: "${errorCode.slice(4)}"`).test(code));
    expect(everyCode.filter((errorCode) => !isUsed(errorCode))).toEqual([]);
  });
});

/**
 * docs/DEVELOPER-API.md, Holds and takedowns: every code in REVIEW_CODES is listed there with its
 * rule and meaning, and every content rule in CONTENT_RULES with its words; nothing else is.
 */
describe("hold and takedown codes", () => {
  const doc = readFileSync(join(ROOT, "docs/DEVELOPER-API.md"), "utf8");
  const section = doc.slice(doc.indexOf("\n## Holds and takedowns\n"), doc.indexOf("\n## Signing in\n"));
  const reviewCodes = Object.keys(REVIEW_CODES);

  it("are lowercase snake_case, and never an error code", () => {
    for (const code of reviewCodes) expect(code).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    expect(reviewCodes.filter((code) => code in ERROR_CODES || code in ADMIN_ERROR_CODES || (INTERNAL_FINDING_CODES as readonly string[]).includes(code))).toEqual([]);
  });

  it("are all listed in docs/DEVELOPER-API.md, as the code has them", () => {
    const listed = [...section.matchAll(/^\| `([a-z0-9_]+)` \| (`[a-z_]+`|none|picked) \| (.+) \|$/gm)].map((row) => ({ code: row[1]!, rule: row[2]!, meaning: row[3]! }));
    expect(listed.map((row) => row.code)).toEqual(reviewCodes);
    for (const row of listed) {
      const known: { meaning: string; contentRule: string | null; isRulePicked?: true } = REVIEW_CODES[row.code as keyof typeof REVIEW_CODES];
      expect(row, row.code).toEqual({ code: row.code, rule: known.contentRule ? `\`${known.contentRule}\`` : known.isRulePicked ? "picked" : "none", meaning: known.meaning });
    }
  });

  it("name content rules that are all listed in docs/DEVELOPER-API.md, as the code has them", () => {
    const listed = [...section.matchAll(/^\| `([a-z_]+)` \| ([^|`]+) \|$/gm)].map((row) => ({ rule: row[1]!, words: row[2]! }));
    expect(listed).toEqual(Object.entries(CONTENT_RULES).map(([rule, words]) => ({ rule, words })));
  });

  it("list what's allowed in docs/DEVELOPER-API.md, as the code has it", () => {
    const listed = section.slice(section.indexOf("(`ALLOWED_CONTENT`)")).split("\n\n")[1]!.trim().split("\n").map((line) => line.replace(/^- /, ""));
    expect(listed).toEqual([...ALLOWED_CONTENT]);
  });

  it("are each one Zaisma can give", () => {
    const code = source().replace(readFileSync(join(ROOT, "packages/core/src/review.ts"), "utf8"), "");
    // The AI judge picks its findings from the ai_ codes (JUDGE_FINDING_CODES in review-judge.ts), and the admin a notice's from NOTICE_CODES.
    const noticeCodes: string[] = Object.values(NOTICE_CODES).map((notice) => notice.code);
    const isUsed = (reviewCode: string) => code.includes(`"${reviewCode}"`) || (JUDGE_FINDING_CODES as string[]).includes(reviewCode) || noticeCodes.includes(reviewCode);
    expect(reviewCodes.filter((reviewCode) => !isUsed(reviewCode))).toEqual([]);
  });
});

describe("room error codes", () => {
  // The SDK's own room codes (packages/sdk/zaisma.d.ts, ErrorCode), beside the ones the room sends.
  const sdkRoomCodes = ["bad_region", "bad_idle_timeout", "zaisma_rooms_not_used"];

  it("are all listed in docs/DEVELOPER-API.md's room connections section, each with a meaning", () => {
    const doc = readFileSync(join(ROOT, "docs/DEVELOPER-API.md"), "utf8");
    const section = doc.slice(doc.indexOf("\n## Room connections\n"), doc.indexOf("\n## Kept rooms\n"));
    const rows = new Map([...section.matchAll(/^\| `([a-z0-9_]+)` \| (.+) \|$/gm)].map((row) => [row[1]!, row[2]!]));
    for (const code of [...Object.keys(ERROR_TEXT), ...sdkRoomCodes]) expect(rows.get(code)?.length, `${code} needs a row in Room connections`).toBeGreaterThan(10);
  });
});
