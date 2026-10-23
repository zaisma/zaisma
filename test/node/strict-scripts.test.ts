import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { pageScripts } from "../../apps/site/src/page-scripts.ts";

/**
 * Strict scripts on zaisma.com (docs/DECISIONS.md), in the site's code itself, so a page no test renders
 * is held to it too (test/site/strict-scripts.test.ts renders the pages). Every page script is a file
 * made with pageScript, and each one must at least parse.
 */

const SITE = join(import.meta.dirname, "../../apps/site/src");
// The site's own modules and its components (components/), not the generated data files.
const sources = [...readdirSync(SITE), ...readdirSync(join(SITE, "components")).map((name) => `components/${name}`)]
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, text: readFileSync(join(SITE, name), "utf8") }));

/**
 * The only <script tags the site writes: html.ts's script files (in the body, in the head holding the first paint, and the theme's and the
 * account link's, which run as they're read) and data blocks, and example game files in the MCP's help (a game's own page, on the game
 * domain). The shader check's page, drawn in a headless browser, is written by packages/cli/shader-check.mjs, which the site shares.
 */
const ALLOWED_SCRIPT_TAGS: Record<string, number> = { "html.ts": 7, "mcp.ts": 2, "page-scripts.ts": 1 };

describe("the site's code", () => {
  it("writes <script> tags only through html.ts", () => {
    const counts = Object.fromEntries(sources.map(({ name, text }) => [name, text.match(/<script/gi)?.length ?? 0]).filter(([, count]) => count));
    expect(counts, "Put a page's script in a file: pageScript in page-scripts.ts, and scriptTags in html.ts").toEqual(ALLOWED_SCRIPT_TAGS);
  });

  it("has no on… attributes and no javascript: addresses", () => {
    const problems = sources.flatMap(({ name, text }) => [
      ...[...text.matchAll(/<[a-zA-Z][^<>]*?\s(on[a-z]+)\s*=/g)].map((found) => `${name}: an ${found[1]} attribute in ${found[0].slice(0, 120)}`),
      ...[...text.matchAll(/["'=(]\s*javascript:/gi)].map((found) => `${name}: javascript: in ${text.slice(Math.max(0, found.index - 60), found.index + 40)}`),
    ]);
    expect(problems, "Handle events in the page's script file (addEventListener), never in the markup").toEqual([]);
  });
});

describe("page scripts", async () => {
  // Every module that makes a page script is reached from the site's router.
  await import("../../apps/site/src/index.ts");
  const scripts = pageScripts();

  it("are all made, each with its own name", () => {
    expect(scripts.length).toBeGreaterThan(20);
    expect(new Set(scripts.map((script) => script.name)).size).toBe(scripts.length);
  });

  it("parse", () => {
    const problems = scripts.flatMap((script) => {
      try {
        new Script(script.sourceText, { filename: `${script.name}.js` });
        return [];
      } catch (error) {
        return [`${script.name}: ${(error as Error).message}`];
      }
    });
    expect(problems).toEqual([]);
  });

  it("never hold a script tag or an inline handler in markup they write", () => {
    const problems = scripts.flatMap((script) => [
      ...(/<script/i.test(script.sourceText) ? [`${script.name} writes a <script> tag`] : []),
      ...[...script.sourceText.matchAll(/<[a-zA-Z][^<>]*?\s(on[a-z]+)\s*=/g)].map((found) => `${script.name} writes an ${found[1]} attribute`),
    ]);
    expect(problems).toEqual([]);
  });
});
