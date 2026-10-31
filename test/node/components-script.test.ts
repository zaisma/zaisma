import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { COMPONENT_SCRIPT, COMPONENT_SCRIPT_SOURCE, COMPONENT_STYLES, FIRST_PAINT_SCRIPT, FIRST_PAINT_SCRIPT_SOURCE } from "../../apps/site/src/components/index.ts";
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

  it("isolates the parent of a stage under the page (the backdrop, the city), so the body's own color never paints over it", () => {
    const styles = COMPONENT_STYLES();
    for (const stage of [".backdrop", ".city-stage"]) expect(styles, stage).toContain(`:has(> ${stage}) { isolation: isolate; }`);
  });

  it("shows a focus ring only for the keyboard: no component's style rings on plain :focus or :focus-within, and a sheet opened by a press takes the focus itself", () => {
    expect(COMPONENT_STYLES().match(/:focus(?![-\w])|:focus-within/g) ?? []).toEqual([]);
    expect(FIRST_PAINT_SCRIPT.sourceText).toContain("zaismaInput");
    expect(COMPONENT_SCRIPT_SOURCE).toContain("function focusSheet");
  });
});
