import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { COMPONENT_SCRIPT, COMPONENT_SCRIPT_SOURCE, COMPONENT_STYLES, FIRST_PAINT_SCRIPT, FIRST_PAINT_SCRIPT_SOURCE, FIRST_PAINT_PIECES, HEADER_SCRIPT, LOOK_SCRIPT, LOOK_SCRIPT_SOURCE } from "../../apps/site/src/components/index.ts";
// @ts-expect-error plain JavaScript without type declarations
import { GENERATED_PATH, minifiedModuleSource } from "../../scripts/minify-components.mjs";

/**
 * The components' script is served minified (scripts/minify-components.mjs writes it as a generated module), so pages download
 * about half as much. A source that changed without the module being written again is served readable, never stale.
 */
describe("the components' script", () => {
  it("is current: run npm run components:minify after changing a component's script", async () => {
    expect(readFileSync(GENERATED_PATH, "utf8")).toBe(await minifiedModuleSource(FIRST_PAINT_PIECES, FIRST_PAINT_SCRIPT_SOURCE, LOOK_SCRIPT_SOURCE, COMPONENT_SCRIPT_SOURCE));
  });

  it("is the minified one: a good deal smaller than the source, and it still parses", () => {
    for (const [script, source] of [[FIRST_PAINT_SCRIPT, FIRST_PAINT_SCRIPT_SOURCE], [LOOK_SCRIPT, LOOK_SCRIPT_SOURCE], [COMPONENT_SCRIPT, COMPONENT_SCRIPT_SOURCE]] as const) {
      expect(script.sourceText.length).toBeLessThan(source.length * 0.7);
      expect(() => new Script(script.sourceText, { filename: `${script.name}.js` })).not.toThrow();
    }
  });

  it("keeps what the pages and tests look for in it: the page watcher and the attributes it reads", () => {
    for (const word of ["zaismaWatch", "data-cut-line", "data-glass", "data-compacts"]) expect(FIRST_PAINT_SCRIPT.sourceText, word).toContain(word);
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

  it("waits through zaismaWait, part of the first paint: every press that sends something on the same page goes through it, and only search as you type and the city fetch outside it", () => {
    expect(FIRST_PAINT_SCRIPT_SOURCE).toContain("window.zaismaWait = function (element, promise)");
    const fetches = [...(FIRST_PAINT_SCRIPT_SOURCE + COMPONENT_SCRIPT_SOURCE).matchAll(/(.{0,40})\bfetch\(([^\n]{0,80})/g)];
    expect(fetches.filter(([, before = "", after = ""]) => !/zaismaWait\([^,]+, $/.test(before) && !after.includes('"search_text="')).map(([found]) => found)).toEqual([]);
  });

  it("lights the header for a new page, after the waiting delay, and puts it out when the page comes back from the browser's history", () => {
    expect(HEADER_SCRIPT.sourceText).toContain('top.classList.toggle("is-waiting", isWaiting)');
    expect(HEADER_SCRIPT.sourceText).toContain('addEventListener("pageshow", function () { setWaiting(false); })');
  });
});

