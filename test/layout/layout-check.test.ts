import { describe, expect, it } from "vitest";
import { cutButton } from "../../apps/site/src/components/actions.ts";
import { glassPane } from "../../apps/site/src/components/foundations.ts";
import { html, raw } from "../../apps/site/src/markup.ts";
import { grid, paneParts, row, stack } from "../../apps/site/src/components/layout.ts";
import { table } from "../../apps/site/src/components/data.ts";
import { gameCard, playingCard } from "../../apps/site/src/components/playing.ts";
import { dropdown, sheet } from "../../apps/site/src/components/panes.ts";
import { cutField } from "../../apps/site/src/components/inputs.ts";
// @ts-expect-error: a Node script with no types of its own.
import { checkPages, chromeToRun, LAYOUT_CHECK_PAGES, LAYOUT_CHECK_SIZES, LAYOUT_CHECK_THEMES, layoutCheckScreens, layoutCheckShard, previewSites } from "../../scripts/layout-check.mjs";

/*
 * The measuring check (scripts/layout-check.mjs, npm run layout:check) on this checkout's preview, in headless Chrome: every page in
 * CHECKED_PAGES, on a phone and a laptop (every screen and 200% text with LAYOUT_CHECK_SCREENS=all, as GitHub's check runs it), light and
 * dark, with nothing out of line; and pages made to break each rule, which it must catch by name. GitHub's check runs it in its own jobs (Layout check, .github/workflows/check.yml) with LAYOUT_CHECK=1, on the
 * preview started from a snapshot of its test data. Elsewhere it runs only on a preview that's already up, and says so when there's none.
 * GitHub's check splits the pages across runners: LAYOUT_CHECK_SHARD="2/3" measures the second of three shares (layoutCheckShard),
 * and the first share also measures the pages broken on purpose.
 */

const isRequired = process.env.LAYOUT_CHECK === "1";
const sites = previewSites({ isStarting: isRequired }) as { site: string; signInSite: string } | null;
if (!sites) console.log("No preview is running, so the layout check is skipped: npm run preview:start, then run this again (LAYOUT_CHECK=1 starts it).");

type Failure = { page: string; size: string; theme: string; check: string; element: string; said: string };
const shard = process.env.LAYOUT_CHECK_SHARD;
const sizes = (process.env.LAYOUT_CHECK_SCREENS === "all" ? layoutCheckScreens("all") : LAYOUT_CHECK_SIZES) as unknown[];
/** A laptop, for the pages broken on purpose. */
const LAPTOP = [{ name: "Laptop", widthPx: 1440, heightPx: 900, isPhone: false, hasTouch: false, isRunnerChecked: true, textPercent: 100 }];
const pages = (shard ? layoutCheckShard(LAYOUT_CHECK_PAGES, shard) : LAYOUT_CHECK_PAGES) as unknown[];
const isFirstShare = !shard || shard.startsWith("1/");

describe.skipIf(!sites)("the layout check", () => {
  it("finds nothing out of line on any page, at any size or theme", async () => {
    const { failures, checkedCount, secondsByPage } = (await checkPages({ ...sites!, pages, sizes, chromePath: await chromeToRun() })) as { failures: Failure[]; checkedCount: number; secondsByPage: Record<string, number> };
    // For PAGE_COSTS_SEC in scripts/layout-check.mjs, when the shares stop finishing together.
    console.log(`Seconds in a tab per page: ${JSON.stringify(secondsByPage)}`);
    expect(checkedCount).toBe(pages.length * sizes.length * LAYOUT_CHECK_THEMES.length);
    expect(failures.map((failure) => `${failure.page} ${failure.size} ${failure.theme}: ${failure.check}: ${failure.element}: ${failure.said}`)).toEqual([]);
  }, 900_000);

  it.skipIf(!isFirstShare)("catches a short control beside a taller one, and a corner control off its corner, naming both", async () => {
    // The real components, then broken the way a hand-made page would be: the row without its one height, the corner control pushed down.
    const unevenRow = row({ widths: "fit", alignment: "end", items: [{ kind: "control", markup: cutButton("Dismiss", { type: "button", isSmall: true }) }, { kind: "control", markup: cutButton("Read more", { type: "button" }) }] }).html.replace(/ data-control-height="[a-z]+"/, "");
    const offCorner = paneParts({ head: { words: html`<h2>Rooms</h2>`, end: cutButton("Refresh", { type: "button" }) }, body: html`<p>Rooms here</p>` }).html.replace('<div class="pane-head-end">', '<div class="pane-head-end" style="margin-top:30px">');
    const markup = glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "block", markup: raw(offCorner) }] }) }).html.replace("</div></section>", `${unevenRow}</div></section>`);
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    const said = failures.map((failure) => `${failure.check}: ${failure.element}`);
    expect(said.some((line) => /different heights/.test(line) && /Dismiss/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /corner/.test(line) && /Refresh/.test(line)), said.join("\n")).toBe(true);
  }, 300_000);

  it.skipIf(!isFirstShare)("catches words inset twice, words off a control's center line, a control off its size class, and two controls side by side outside a row", async () => {
    // The real components, then broken the way a hand-made page would be.
    const insetTwice = stack({ items: [{ kind: "words", markup: html`<p>Inset twice</p>` }] }).html.replace("<p>Inset twice</p>", '<p style="padding-left:12px">Inset twice</p>');
    const offCenter = paneParts({ head: { words: html`<h2>Versions</h2>`, end: cutButton("New version", { type: "button" }) }, body: html`<p>Every version</p>` }).html.replace("<h2>Versions</h2>", '<h2 style="padding-top:30px">Versions</h2>');
    const offSize = cutButton("Too short", { type: "button" }).html.replace('<span class="face cut-raised"', '<span style="height:40px" class="face cut-raised"');
    const sideBySide = `<div style="display:flex;gap:8px">${cutButton("Keep", { type: "button" }).html}${cutButton("Drop", { type: "button" }).html}</div>`;
    const markup = glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "block", markup: raw(offCenter) }, { kind: "block", markup: raw(insetTwice) }, { kind: "block", markup: raw(offSize) }, { kind: "block", markup: raw(sideBySide) }] }) }).html;
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    const said = failures.map((failure) => `${failure.check}: ${failure.element}`);
    expect(said.some((line) => /off the pane's margin/.test(line) && /Inset twice/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /off its center line/.test(line) && /Versions/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /size class/.test(line) && /Too short/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /side by side outside a row/.test(line) && /Drop|Keep/.test(line)), said.join("\n")).toBe(true);
  }, 300_000);

  it.skipIf(!isFirstShare)("cuts anything with an edge in a pane's corner by itself, and catches one kept square", async () => {
    // Two panes, each with a filled box at its foot and nothing asking for a cut: the edge rule cuts the first; the second is forced square.
    const boxPane = (box: string) => glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "words", markup: html`<p>Pictures</p>` }, { kind: "block", markup: raw(box) }] }) }).html;
    const markup = boxPane('<div style="height:60px;background:#4a7"></div>') + boxPane('<div class="kept-square" style="height:60px;background:#47a"></div><style>.kept-square{clip-path:none!important}</style>');
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    const square = failures.filter((failure) => /square in a cut corner/.test(failure.check));
    expect(square.length, failures.map((failure) => `${failure.check}: ${failure.element}`).join("\n")).toBe(1);
  }, 300_000);

  it.skipIf(!isFirstShare)("catches a bare group closer to the pane's edge than the words margin, naming the card, and passes a grid of game cards as it is", async () => {
    // A grid of game cards as the components make it (inset as one unit), and once with its inset taken away, as a page's own style might.
    const cards = () => grid({ whenEmpty: html`<p>No games here yet.</p>`, itemSize: "cover", items: ["kestrel", "verdant"].map((slug) => ({ kind: "block" as const, markup: gameCard({ title: slug === "kestrel" ? "Kestrel" : "Verdant", imageUrl: `/design/covers/${slug}.webp`, href: `#${slug}`, facts: { playerCount: 12 } }) })) }).html;
    const pane = (grids: string) => glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "words", markup: html`<h2>More</h2>` }, { kind: "block", markup: raw(grids) }] }) }).html;
    const markup = pane(cards()) + pane(cards()).replace('class="layout-grid', 'style="padding-inline:0" class="layout-grid');
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    const close = failures.filter((failure) => /bare group closer to the pane's edge/.test(failure.check));
    expect(close.length, failures.map((failure) => `${failure.check}: ${failure.element}`).join("\n")).toBeGreaterThan(0);
    expect(close.every((failure) => /Kestrel|Verdant/.test(failure.element))).toBe(true);
    // Only the second pane's first card is at the edge: the first pane's cards keep the margin.
    expect(close.length).toBeLessThan(3);
  }, 300_000);

  it.skipIf(!isFirstShare)("catches words closer to a card's edge than the words margin, and passes the same card as it is", async () => {
    // A playing card in place, once as the components make it and once with its inner padding forced down to 12px, as a page might style it.
    const card = (id: string) => playingCard({ id, title: "Keep your progress", body: raw("<p>Sign in to keep what you've done.</p>"), isShown: true, isInPlace: true }).html;
    const markup = card("fine-card") + card("close-card").replace('class="playing-card-in"', 'class="playing-card-in" style="padding:12px;--pad-words:0px"');
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    const close = failures.filter((failure) => /words closer to the pane's edge than its margin/.test(failure.check));
    expect(close.length, failures.map((failure) => `${failure.check}: ${failure.element}`).join("\n")).toBeGreaterThan(0);
    expect(close.every((failure) => /close-card|Keep your progress|Sign in to keep/.test(`${failure.element} ${failure.said}`))).toBe(true);
    expect(close.some((failure) => /fine-card/.test(`${failure.element} ${failure.said}`))).toBe(false);
  }, 300_000);

  // Each new rule, on a laptop: a fixture built to break it, and its fixed twin beside it, which it must pass.
  const brokenOnLaptop = async (markup: string) => {
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    return failures.map((failure) => `${failure.check}: ${failure.element}: ${failure.said}`);
  };
  const fullPane = (body: string) => glassPane({ paneWidth: "full", body: raw(body) }).html;
  const choices = (count: number) => Array.from({ length: count }, (_, index) => ({ label: `Choice ${index + 1}`, href: "#menu" }));

  it.skipIf(!isFirstShare)("catches a pane wider than its page's shape, and panes over the page past their kind's size, past the screen or overflowing unscrolled", async () => {
    // The example page is a reading page (820px); a menu with 30 choices scrolls inside itself as it is, and spills when it's made not to.
    const tooWide = `<div style="width:1100px">${fullPane("<p>Wider than its shape</p>")}</div>`;
    const menu = dropdown({ id: "fixture-menu", label: "Fine menu", items: choices(30), isOpen: true }).html.replace('class="dropdown glass"', 'style="top:8px;left:8px" class="dropdown glass"');
    const spilling = dropdown({ id: "fixture-spill", label: "Spilling menu", items: choices(30), isOpen: true }).html.replace('class="dropdown glass"', 'style="top:8px;left:400px;max-height:none" class="dropdown glass"').replace('class="dropdown-in"', 'style="overflow:visible" class="dropdown-in"');
    const wideSheet = sheet({ id: "fixture-sheet", title: "Too wide", body: html`<p>A sheet</p>`, closeLabel: "Close", isShown: true }).html.replace('class="sheet', 'style="width:900px;max-width:none" class="sheet');
    const said = await brokenOnLaptop(tooWide + menu + spilling + wideSheet);
    expect(said.some((line) => /wider than its page's shape/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /taller than its kind allows/.test(line) && /Choice/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /a pane past the screen/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /wider than its kind allows/.test(line) && /Too wide/.test(line)), said.join("\n")).toBe(true);
    // The fine menu scrolls inside itself: nothing names it.
    expect(said.filter((line) => /Fine menu|Choice 1"/.test(line) && /pane (taller|past|that overflows)/.test(line) && !/400px/.test(line)).length, said.join("\n")).toBeLessThan(2);
  }, 300_000);

  it.skipIf(!isFirstShare)("catches the Laws of UX it can measure: proximity, common region, similarity, hierarchy, choices, chunking and an answer within 400 ms", async () => {
    const hugging = fullPane(stack({ items: [{ kind: "block", markup: raw(table({ caption: "Rooms", columns: [{ label: "Room" }], rows: [["North"]], whenEmpty: html`<p>No rooms.</p>` }).html) }, { kind: "words", markup: html`<h2>Hugging the table</h2>` }, { kind: "words", markup: html`<p>What it names</p>` }] }).html.replace("<h2>Hugging the table</h2>", '<h2 style="margin-top:-20px;margin-bottom:30px">Hugging the table</h2>'));
    const splitGroup = fullPane(html`<p>Before</p><h2>Left alone</h2>`.html) + fullPane("<p>Its group, on another pane</p>");
    const mixedGrid = fullPane(grid({ itemSize: "card", whenEmpty: html`<p>None.</p>`, items: ["One", "Two"].map((title) => ({ kind: "block" as const, markup: glassPane({ paneWidth: "full", body: html`<p>${title}</p>` }) })) }).html.replace('<div class="grid-cell is-block">', '<div class="grid-cell is-block" style="max-width:120px">'));
    const twoTitles = fullPane('<h1>First title</h1><h1>Second title</h1><h4>Skipped a level</h4>');
    const sixEqual = fullPane(row({ widths: "fit", items: ["A", "B", "C", "D", "E", "F"].map((label) => ({ kind: "control" as const, markup: cutButton(label, { type: "button" }) })) }).html);
    const longMenu = dropdown({ id: "fixture-long-menu", label: "Ten choices", items: choices(10), isOpen: true }).html.replace('class="dropdown glass"', 'style="top:8px;left:8px" class="dropdown glass"');
    const eightFields = fullPane(stack({ items: Array.from({ length: 8 }, (_, index) => ({ kind: "control" as const, markup: cutField({ id: `fixture-field-${index}`, name: `field_${index}`, label: `Field ${index + 1}`, type: "text" }) })) }).html);
    const deaf = fullPane('<button type="button" aria-controls="nothing-at-all">Answers nothing</button>');
    const said = await brokenOnLaptop(hugging + splitGroup + mixedGrid + twoTitles + sixEqual + longMenu + eightFields + deaf);
    for (const [check, named] of [
      [/words nearer the block before than their own/, /Hugging the table/],
      [/one group on two surfaces/, /Left alone/],
      [/one kind at different sizes/, /Two|One/],
      [/more than one title/, /Second title/],
      [/headings out of order/, /Skipped a level/],
      [/too many equal choices/, /A|Ten choices|Choice/],
      [/a long form in one piece/, /Field 8/],
      [/no answer within 400 ms/, /Answers nothing/],
    ] as const) expect(said.some((line) => check.test(line) && named.test(line)), `${check}\n${said.join("\n")}`).toBe(true);
  }, 300_000);
});
