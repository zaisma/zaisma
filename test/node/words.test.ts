import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_ERROR_CODES, ERROR_CODES } from "../../packages/core/src/errors.ts";
import { REVIEW_CODES } from "../../packages/core/src/review.ts";
import { BANNED_WORDS, FILLER_WORDS, wordProblems } from "../../packages/core/src/words.ts";

/**
 * Every public word is written for one reader (docs/DESIGN.md, Voice). The word rules fail what breaks them,
 * every error and review code has a text for people that keeps them, and pages read only that text: an
 * error's, finding's or alert's `fix` is the AI's, read only where an AI or a game's code gets the answer.
 */

const ROOT = join(import.meta.dirname, "../..");

/** The files in apps/site/src that read a `fix` (or the old messageWithFix), each with why it may. */
const FIX_READERS: Record<string, { why: string; onlyReads?: string[] }> = {
  "apps/site/src/mcp.ts": { why: "an AI reads the MCP's answers" },
  "apps/site/src/admin-mcp.ts": { why: "an AI reads the admin MCP's answers" },
  "apps/site/src/buy-sheet.ts": { why: "the answer goes to the game's code through the SDK, and the game shows its own words" },
  "apps/site/src/buy.ts": { why: "the answer goes to the game's code through the SDK, and the game shows its own words" },
  "apps/site/src/backgrounds-api.ts": { why: "an API answer, for the caller" },
  "apps/site/src/secrets-api.ts": { why: "an API answer, for the caller" },
  "apps/site/src/forum-posts.ts": { why: "an API answer, for the caller" },
  "apps/site/src/developer.ts": { why: "API answers, for the caller; the people's text goes beside each" },
  "apps/site/src/dashboard.ts": { why: "a version's performance notes and a shader check's notes: build advice for the developer, written with no call names", onlyReads: ["note.fix", "each.fix"] },
};

function siteFiles(directory = "apps/site/src"): string[] {
  return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? siteFiles(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : [],
  );
}

describe("the word rules", () => {
  it("fail each rule, naming the words", () => {
    expect(wordProblems("We keep your progress.", "page")).toEqual(['Zaisma, never "we": We']);
    expect(wordProblems("Our team looks at it, then tells us.", "page")).toEqual(['Zaisma, never "we": Our, us']);
    expect(wordProblems("You're in!", "page")).toEqual(['No "!"']);
    expect(wordProblems("Bring your worlds to life with the community.", "page")).toEqual(["No marketing words: worlds, community"]);
    expect(wordProblems("Hang tight, it's just a moment.", "page")).toEqual(["No filler: Hang tight, just"]);
    expect(wordProblems("Call delete_webhook to remove one.", "page")).toEqual(["No names from the code: delete_webhook"]);
    expect(wordProblems("Zaisma doesn't take a share, and it's yours.", "legal")).toEqual(["No contractions on legal pages: n't, it's"]);
  });

  it("pass Zaisma's own lines, and the country in capitals", () => {
    expect(wordProblems("Stripe didn't connect. The link may have expired: try Connect Stripe again.", "page")).toEqual([]);
    expect(wordProblems("You have no friends here yet. Send someone your link, and they show up here once they open it.", "page")).toEqual([]);
    expect(wordProblems("Zaisma does not take a share of your sales.", "legal")).toEqual([]);
    expect(wordProblems("These rules follow US law.", "legal")).toEqual([]);
    expect(wordProblems("Any engine. No cut.", "page")).toEqual([]);
  });

  it("have each word once, lowercase", () => {
    for (const words of [BANNED_WORDS, FILLER_WORDS]) {
      expect(new Set(words).size).toBe(words.length);
      for (const word of words) expect(word).toBe(word.toLowerCase());
    }
  });
});

describe("the text for people", () => {
  it("is on every error code and keeps the word rules", () => {
    const problems = Object.entries({ ...ERROR_CODES, ...ADMIN_ERROR_CODES }).flatMap(([code, entry]) => wordProblems(entry.messageForPeople, "page").map((problem) => `${code}: ${problem}`));
    expect(problems).toEqual([]);
  });

  it("is on every review code and keeps the word rules", () => {
    const problems = Object.entries(REVIEW_CODES).flatMap(([code, entry]) => wordProblems(entry.messageForPeople, "page").map((problem) => `${code}: ${problem}`));
    expect(problems).toEqual([]);
  });

  it("is what pages read: a fix is read only where an AI or a game's code gets the answer", () => {
    const readers = siteFiles().flatMap((file) => {
      const source = readFileSync(join(ROOT, file), "utf8");
      const reads = [...source.matchAll(/([\w)\]]+\??)\.fix\b|messageWithFix/g)].map((match) => match[0]);
      return reads.length ? [{ file, reads: [...new Set(reads)] }] : [];
    });
    const wrong = readers.filter(({ file, reads }) => !FIX_READERS[file] || (FIX_READERS[file]!.onlyReads && reads.some((read) => !FIX_READERS[file]!.onlyReads!.includes(read))));
    expect(wrong).toEqual([]);
    for (const file of Object.keys(FIX_READERS)) expect(readers.map((reader) => reader.file), `${file} no longer reads a fix: take it off FIX_READERS`).toContain(file);
  });
});

describe("DESIGN.md's Voice", () => {
  it("points to the word lists the checks use", () => {
    const design = readFileSync(join(ROOT, "docs/DESIGN.md"), "utf8");
    expect(design.slice(design.indexOf("\n## Voice\n"), design.indexOf("\n## Tokens\n"))).toContain("packages/core/src/words.ts");
  });
});
