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
});
