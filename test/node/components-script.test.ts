import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { COMPONENT_SCRIPT, COMPONENT_SCRIPT_SOURCE, COMPONENT_STYLES, FIRST_PAINT_SCRIPT, FIRST_PAINT_SCRIPT_SOURCE, FIRST_PAINT_PIECES, HEADER_SCRIPT, LOOK_SCRIPT, LOOK_SCRIPT_SOURCE } from "../../apps/site/src/components/index.ts";
// @ts-expect-error plain JavaScript without type declarations
import { GENERATED_PATH, minifiedModuleSource } from "../../scripts/minify-components.mjs";
import { SIDEBAR_SCRIPT } from "../../apps/site/src/components/navigation.ts";

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

  it("isolates the parent of a stage under the page (the backdrop, the live world), so the body's own color never paints over it", () => {
    const styles = COMPONENT_STYLES();
    for (const stage of [".backdrop", ".world-stage"]) expect(styles, stage).toContain(`:has(> ${stage}) { isolation: isolate; }`);
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

  it("keeps a folding sidebar shown until it has left, and finds a search from its Clear", () => {
    expect(COMPONENT_STYLES()).toContain(".sidebar-layout.is-collapsed:not(.is-folding) > .sidebar-layout-in > .sidebar { display: none; }");
    expect(COMPONENT_SCRIPT_SOURCE).toContain(`clear.closest(".find").querySelector('input[type="search"]')`);
  });

  it("lets an open floating pane take its own presses, wherever it's moved to", () => {
    expect(COMPONENT_STYLES()).toContain(".floating-pane:popover-open { pointer-events: auto; }");
  });

  it("keeps a wheel's row exactly the groove's row, and a regular floating pane's frame gap its padding", () => {
    expect(COMPONENT_STYLES()).toContain('.wheel [role="option"] { --row-height: var(--wheel-row); --row-start: var(--pad-inside-words); --row-end: var(--pad-inside-words); padding-block: 0; gap: 0;');
    expect(COMPONENT_STYLES()).toContain(".floating-pane.regular { padding: var(--pad-frame); --pad-words: var(--pad-inside-words); --rail-inset: var(--pad-frame); }");
  });

  it("ends a sidebar's last fold when it's pressed again, so the page never drops into its column", () => {
    expect(SIDEBAR_SCRIPT).toContain("cancelAnimationFrame(nav.foldFrame); clearTimeout(nav.foldTimer); clearTimeout(nav.slideTimer);");
  });

  it("empties a search's list only once it has faded, so it never shrinks as it goes", () => {
    expect(COMPONENT_SCRIPT_SOURCE).toContain("if (!typed) { setActive(-1); hide(); emptyOnceGone(); return; }");
    expect(COMPONENT_SCRIPT_SOURCE).toContain("if (!next.length && !nextGames.length) { setActive(-1); hide(); emptyOnceGone(); return; }");
    expect(COMPONENT_SCRIPT_SOURCE).toContain("list.getAnimations({ subtree: true })");
  });

  it("lights the header for a new page, after the waiting delay, and puts it out when the page comes back from the browser's history", () => {
    expect(HEADER_SCRIPT.sourceText).toContain('document.querySelectorAll("header.glass-bar").forEach(function (bar) { if (!bar.hasAttribute("data-stays-waiting")) bar.classList.toggle("is-waiting", isWaiting); });');
    expect(HEADER_SCRIPT.sourceText).toContain('addEventListener("pageshow", function () { setWaiting(false); })');
    // A stacked switch opens the next page itself, and says so, so its links light the header too.
    expect(HEADER_SCRIPT.sourceText).toContain('document.addEventListener("zaisma-leaving-page"');
  });
});

