import { describe, expect, it } from "vitest";
import { cutButton } from "../../apps/site/src/components/actions.ts";
import { glassPane } from "../../apps/site/src/components/foundations.ts";
import { html, raw } from "../../apps/site/src/markup.ts";
import { paneParts, row, stack } from "../../apps/site/src/components/layout.ts";
// @ts-expect-error: a Node script with no types of its own.
import { checkPages, chromeToRun, previewSites } from "../../scripts/layout-check.mjs";

/*
 * The measuring check (scripts/layout-check.mjs, npm run layout:check) on this checkout's preview, in headless Chrome: every page in
 * CHECKED_PAGES, at 320 x 667 and 1440 x 900, light and dark, with nothing out of line; and a page made to break two rules, which it
 * must catch by name. GitHub's check runs it in its own job (Layout check, .github/workflows/check.yml) with LAYOUT_CHECK=1, which
 * starts the preview first. Elsewhere it runs only on a preview that's already up, and says so when there's none.
 */

const isRequired = process.env.LAYOUT_CHECK === "1";
const sites = previewSites({ isStarting: isRequired }) as { site: string; signInSite: string } | null;
if (!sites) console.log("No preview is running, so the layout check is skipped: npm run preview:start, then run this again (LAYOUT_CHECK=1 starts it).");

type Failure = { page: string; size: string; theme: string; check: string; element: string; said: string };

describe.skipIf(!sites)("the layout check", () => {
  it("finds nothing out of line on any page, at any size or theme", async () => {
    const { failures, checkedCount } = (await checkPages({ ...sites!, chromePath: await chromeToRun() })) as { failures: Failure[]; checkedCount: number };
    expect(checkedCount).toBeGreaterThan(40);
    expect(failures.map((failure) => `${failure.page} ${failure.size} ${failure.theme}: ${failure.check}: ${failure.element}: ${failure.said}`)).toEqual([]);
  }, 900_000);

  it("catches a short control beside a taller one, and a corner control off its corner, naming both", async () => {
    // The real components, then broken the way a hand-made page would be: the row without its one height, the corner control pushed down.
    const unevenRow = row({ widths: "fit", alignment: "end", items: [{ kind: "control", markup: cutButton("Dismiss", { type: "button", isSmall: true }) }, { kind: "control", markup: cutButton("Read more", { type: "button" }) }] }).html.replace(/ data-control-height="[a-z]+"/, "");
    const offCorner = paneParts({ head: { words: html`<h2>Rooms</h2>`, end: cutButton("Refresh", { type: "button" }) }, body: html`<p>Rooms here</p>` }).html.replace('<div class="pane-head-end">', '<div class="pane-head-end" style="margin-top:30px">');
    const markup = glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "block", markup: raw(offCorner) }] }) }).html.replace("</div></section>", `${unevenRow}</div></section>`);
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: [{ name: "1440 x 900", widthPx: 1440, heightPx: 900, isPhone: false }], themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    const said = failures.map((failure) => `${failure.check}: ${failure.element}`);
    expect(said.some((line) => /different heights/.test(line) && /Dismiss/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /corner/.test(line) && /Refresh/.test(line)), said.join("\n")).toBe(true);
  }, 300_000);

  it("catches words inset twice, words off a control's center line, a control off its size class, and two controls side by side outside a row", async () => {
    // The real components, then broken the way a hand-made page would be.
    const insetTwice = stack({ items: [{ kind: "words", markup: html`<p>Inset twice</p>` }] }).html.replace("<p>Inset twice</p>", '<p style="padding-left:12px">Inset twice</p>');
    const offCenter = paneParts({ head: { words: html`<h2>Versions</h2>`, end: cutButton("New version", { type: "button" }) }, body: html`<p>Every version</p>` }).html.replace("<h2>Versions</h2>", '<h2 style="padding-top:30px">Versions</h2>');
    const offSize = cutButton("Too short", { type: "button" }).html.replace('<span class="face cut-raised"', '<span style="height:40px" class="face cut-raised"');
    const sideBySide = `<div style="display:flex;gap:8px">${cutButton("Keep", { type: "button" }).html}${cutButton("Drop", { type: "button" }).html}</div>`;
    const markup = glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "block", markup: raw(offCenter) }, { kind: "block", markup: raw(insetTwice) }, { kind: "block", markup: raw(offSize) }, { kind: "block", markup: raw(sideBySide) }] }) }).html;
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: [{ name: "1440 x 900", widthPx: 1440, heightPx: 900, isPhone: false }], themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    const said = failures.map((failure) => `${failure.check}: ${failure.element}`);
    expect(said.some((line) => /off the pane's margin/.test(line) && /Inset twice/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /off its center line/.test(line) && /Versions/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /size class/.test(line) && /Too short/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /side by side outside a row/.test(line) && /Drop|Keep/.test(line)), said.join("\n")).toBe(true);
  }, 300_000);

  it("cuts anything with an edge in a pane's corner by itself, and catches one kept square", async () => {
    // Two panes, each with a filled box at its foot and nothing asking for a cut: the edge rule cuts the first; the second is forced square.
    const boxPane = (box: string) => glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "words", markup: html`<p>Pictures</p>` }, { kind: "block", markup: raw(box) }] }) }).html;
    const markup = boxPane('<div style="height:60px;background:#4a7"></div>') + boxPane('<div class="kept-square" style="height:60px;background:#47a"></div><style>.kept-square{clip-path:none!important}</style>');
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: [{ name: "1440 x 900", widthPx: 1440, heightPx: 900, isPhone: false }], themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    const square = failures.filter((failure) => /square in a cut corner/.test(failure.check));
    expect(square.length, failures.map((failure) => `${failure.check}: ${failure.element}`).join("\n")).toBe(1);
  }, 300_000);
});
