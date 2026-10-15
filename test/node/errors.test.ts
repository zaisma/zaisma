import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "../../packages/core/src/errors.ts";

/**
 * docs/NAMING.md, Errors: one list of codes. Every code in ERROR_CODES is listed in
 * docs/DEVELOPER-API.md with its HTTP status and meaning, nothing else is listed there, and every
 * code is one the code can answer with.
 */

const ROOT = join(import.meta.dirname, "../..");

/** The rows of the Errors section's tables: | `code` | HTTP | Meaning |. */
function listedCodes(): { code: string; httpStatus: number; meaning: string }[] {
  const doc = readFileSync(join(ROOT, "docs/DEVELOPER-API.md"), "utf8");
  const section = doc.slice(doc.indexOf("\n## Errors\n"), doc.indexOf("\n## Next steps\n"));
  return [...section.matchAll(/^\| `([a-z0-9_]+)` \| (\d+) \| (.+) \|$/gm)].map((row) => ({ code: row[1]!, httpStatus: Number(row[2]), meaning: row[3]! }));
}

/** Zaisma's own source that can answer with an error, without the list itself. */
function source(): string {
  const read = (directory: string): string[] =>
    readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? read(join(directory, entry.name)) : entry.name.endsWith(".ts") && entry.name !== "errors.ts" ? [readFileSync(join(ROOT, directory, entry.name), "utf8")] : [],
    );
  return [...read("apps/site/src"), ...read("packages/core/src")].join("\n");
}

describe("error codes", () => {
  it("are lowercase snake_case", () => {
    for (const code of Object.keys(ERROR_CODES)) expect(code).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
  });

  it("are all listed in docs/DEVELOPER-API.md, as the code has them", () => {
    const listed = listedCodes();
    expect(listed.map((row) => row.code)).toEqual(Object.keys(ERROR_CODES));
    for (const row of listed) expect(row, row.code).toEqual({ code: row.code, ...ERROR_CODES[row.code as keyof typeof ERROR_CODES] });
  });

  it("are each one the code can answer with", () => {
    const code = source();
    // bad_<field> codes made from the field's name: the field is given where its value is checked.
    const isUsed = (errorCode: string) =>
      code.includes(`"${errorCode}"`) || (errorCode.startsWith("bad_") && new RegExp(`(oneOf|refuse)\\("${errorCode.slice(4)}"|\\["${errorCode.slice(4)}", |field: "${errorCode.slice(4)}"`).test(code));
    expect(Object.keys(ERROR_CODES).filter((errorCode) => !isUsed(errorCode))).toEqual([]);
  });
});
