import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { COMPONENT_SCRIPT, COMPONENT_SCRIPT_SOURCE } from "../../apps/site/src/components/index.ts";
// @ts-expect-error plain JavaScript without type declarations
import { GENERATED_PATH, minifiedModuleSource } from "../../scripts/minify-components.mjs";

/**
 * The components' script is served minified (scripts/minify-components.mjs writes it as a generated module), so pages download
 * about half as much. A source that changed without the module being written again is served readable, never stale.
 */
describe("the components' script", () => {
  it("is current: run npm run components:minify after changing a component's script", async () => {
    expect(readFileSync(GENERATED_PATH, "utf8")).toBe(await minifiedModuleSource(COMPONENT_SCRIPT_SOURCE));
  });

  it("is the minified one: a good deal smaller than the source, and it still parses", () => {
    expect(COMPONENT_SCRIPT.sourceText.length).toBeLessThan(COMPONENT_SCRIPT_SOURCE.length * 0.7);
    expect(() => new Script(COMPONENT_SCRIPT.sourceText, { filename: "components.js" })).not.toThrow();
  });

  it("keeps what the pages and tests look for in it: the page watcher and the attributes it reads", () => {
    for (const word of ["zaismaWatch", "data-cut-line", "data-glass", "data-compacts"]) expect(COMPONENT_SCRIPT.sourceText, word).toContain(word);
  });
});
