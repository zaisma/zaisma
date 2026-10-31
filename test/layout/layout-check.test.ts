import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STAND_IN_COVER_PICTURES } from "../../apps/site/src/generated/stand-in-placeholders.generated.ts";
import { describe, expect, it } from "vitest";
import { secondaryButton } from "../../apps/site/src/components/actions.ts";
import { glassPane } from "../../apps/site/src/components/foundations.ts";
import { html, raw } from "../../apps/site/src/markup.ts";
import { grid, paneParts, stack, type LayoutMarkup } from "../../apps/site/src/components/layout.ts";

/** A pane's body built by hand past the types, as a page could still forge one: these fixtures are pages the check must catch. */
const forged = (markup: { html: string }) => raw(markup.html) as unknown as LayoutMarkup;
import { table } from "../../apps/site/src/components/data.ts";
import { dropdown, gameCard, notice, sheet } from "../../apps/site/src/components/panes.ts";
import { LAYOUT_RULE_TIERS } from "../../apps/site/src/components/layout-measure.ts";
import { MEASURED_SCREEN_NAMES, TEXT_SCREEN_NAMES } from "../../apps/site/src/components/checked-pages.ts";
import layoutMeasureSource from "../../apps/site/src/components/layout-measure.ts?raw";
import layoutCheckSource from "../../scripts/layout-check.mjs?raw";
// @ts-expect-error: a Node script with no types of its own.
import { checkPages, chromeToRun, LAYOUT_CHECK_RUNS, layoutCheckShard, pageFingerprint, pagesNamed, previewSites } from "../../scripts/layout-check.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { mergeMeasured, readMeasured } from "../../scripts/merge-measured.mjs";

/*
 * The measuring check (scripts/layout-check.mjs, npm run layout:check) on this checkout's preview, in headless Chrome: a run's pages
 * (LAYOUT_CHECK_RUNS: a pull request's unless LAYOUT_CHECK_RUN says gallery or sweep), with nothing out of line; and pages made to break
 * each rule, which it must catch by name. GitHub's check runs it in its own job (Layout check, .github/workflows/check.yml) with
 * LAYOUT_CHECK=1, on the preview started from a snapshot of its test data. Elsewhere it runs only on a preview that's already up, and says
 * so when there's none. LAYOUT_CHECK_SHARD="2/4" measures the second of four shares (layoutCheckShard), and the first share also measures
 * the pages broken on purpose. A pull request's run skips each page that passed before as it is (PASSED_PATH); LAYOUT_CHECK_FRESH=1
 * measures every page, as the merge queue's and main's runs do.
 */

const isRequired = process.env.LAYOUT_CHECK === "1";
const sites = previewSites({ isStarting: isRequired }) as { site: string; signInSite: string } | null;
if (!sites) console.log("No preview is running, so the layout check is skipped: npm run preview:start, then run this again (LAYOUT_CHECK=1 starts it).");

type Failure = { page: string; size: string; theme: string; check: string; element: string; said: string };
type LayoutRun = { pages: { name: string; isGallery?: boolean }[]; sizes: unknown[]; themes: string[]; tiersOf: (page: unknown) => string[] };
const RUNS = LAYOUT_CHECK_RUNS as Record<"pull_request" | "gallery" | "sweep", LayoutRun>;
const shard = process.env.LAYOUT_CHECK_SHARD;
const layoutRun = RUNS[(process.env.LAYOUT_CHECK_RUN ?? "pull_request") as keyof typeof RUNS];
/** A laptop, for the pages broken on purpose. */
const LAPTOP = [{ name: "Laptop", widthPx: 1440, heightPx: 900, isPhone: false, hasTouch: false, isRunnerChecked: true, textPercent: 100 }];
const pages = (shard ? layoutCheckShard(layoutRun.pages, shard) : layoutRun.pages) as unknown[];
const isFirstShare = !shard || shard.startsWith("1/");
/**
 * The pages a pull request's run passed before, by fingerprint (layout-check.mjs, pageFingerprint: the page's HTML, whose CSS and script
 * addresses carry their change, the run and the check's own code), which GitHub's Layout check keeps between a pull request's pushes
 * (check.yml). Only passes are kept, so a failure is always measured again.
 */
const PASSED_PATH = join(import.meta.dirname, "../../.wrangler/layout-check-passed.json");
const isSkippingPassed = layoutRun === RUNS.pull_request && process.env.LAYOUT_CHECK_FRESH !== "1";
const onlyPassed = (measured: Record<string, string>) => Object.fromEntries(Object.entries(measured).filter(([, result]) => result === "passed"));

describe("the measured rules", () => {
  it("each have a tier, so a new rule can't land without one, and every tier names a rule that's measured", () => {
    const names = [...layoutMeasureSource.matchAll(/report\("([^"]+)"/g), ...layoutCheckSource.matchAll(/check: "([^"$]+)"/g)].map((match) => match[1]!);
    expect(names.filter((name) => !(name in LAYOUT_RULE_TIERS))).toEqual([]);
    expect(Object.keys(LAYOUT_RULE_TIERS).filter((name) => !names.includes(name))).toEqual([]);
  });

  it("are measured as each run says: a pull request's every page for its arrangement on two screens in light, the gallery's for its components too", () => {
    expect(RUNS.pull_request.themes).toEqual(["light"]);
    expect(RUNS.pull_request.pages.some((page) => / (long names|empty|full)$/.test(page.name))).toBe(false);
    expect(RUNS.pull_request.tiersOf({ name: "Home" })).toEqual(["page"]);
    expect(RUNS.pull_request.tiersOf({ name: "Gallery: layout", isGallery: true })).toEqual(["gallery", "page"]);
    expect(RUNS.gallery.pages.every((page) => page.isGallery)).toBe(true);
    expect(RUNS.sweep.tiersOf({ name: "Home" })).toEqual(["gallery", "page", "sweep"]);
    expect(RUNS.sweep.sizes.length).toBeGreaterThan(RUNS.pull_request.sizes.length);
  });

  it("are measured in light on the measured screens by the gallery and the sweep, with the arrangements a layout component makes proven on the gallery", () => {
    const measuredSizeNames = [...MEASURED_SCREEN_NAMES, ...TEXT_SCREEN_NAMES.map((name) => `${name} at 200% text`)];
    for (const run of [RUNS.gallery, RUNS.sweep]) {
      expect(run.themes).toEqual(["light"]);
      expect((run.sizes as { name: string }[]).map((size) => size.name)).toEqual(measuredSizeNames);
    }
    for (const name of ["two panes closer than a block's gap", "two panes overlapping", "out of line with the header", "controls in one row not on one line", "words nearer the block before than their own", "one group on two surfaces"]) expect(LAYOUT_RULE_TIERS[name], name).toBe("gallery");
    for (const name of ["overlaps another thing", "spills out of its pane", "words cut off", "the page scrolls sideways", "the runner below the fold", "an empty thing taking a gap", "two controls side by side outside a row"]) expect(LAYOUT_RULE_TIERS[name], name).toBe("page");
  });
});

describe("the merge queue's skip", () => {
  const page = { name: "Home", path: "/", mainActionShows: "everywhere" };
  const looks = [{ size: { name: "Phone" }, theme: "light" }, { size: { name: "Laptop" }, theme: "dark" }];
  const markup = (stylesheet: string, nonce: string, token: string, settledMs: string) => `<html><head><link rel="stylesheet" href="/css/site.${stylesheet}.css"><script nonce="${nonce}"></script></head><body><form><input type="hidden" name="token" value="${token}"><input name="search_text" value="farm"></form><div data-settled-ms="${settledMs}">Home</div></body></html>`;
  it("fingerprints a page the same across loads, with what changes on every load taken out", () => {
    const fingerprint = pageFingerprint(markup("a1", "n1", "t1", "120"), page, looks, ["page"]);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(pageFingerprint(markup("a1", "n2", "t2", "480"), page, looks, ["page"])).toBe(fingerprint);
  });
  it("fingerprints it again when its stylesheet, its words, its entry or the run changes", () => {
    const fingerprint = pageFingerprint(markup("a1", "n1", "t1", "120"), page, looks, ["page"]);
    expect(pageFingerprint(markup("b2", "n1", "t1", "120"), page, looks, ["page"])).not.toBe(fingerprint);
    expect(pageFingerprint(markup("a1", "n1", "t1", "120").replace(">Home<", ">Home, longer<"), page, looks, ["page"])).not.toBe(fingerprint);
    expect(pageFingerprint(markup("a1", "n1", "t1", "120").replace('value="farm"', 'value="cave"'), page, looks, ["page"])).not.toBe(fingerprint);
    expect(pageFingerprint(markup("a1", "n1", "t1", "120"), { ...page, mainActionShows: "nowhere" }, looks, ["page"])).not.toBe(fingerprint);
    expect(pageFingerprint(markup("a1", "n1", "t1", "120"), page, looks.slice(1), ["page"])).not.toBe(fingerprint);
    expect(pageFingerprint(markup("a1", "n1", "t1", "120"), page, looks, ["gallery", "page", "sweep"])).not.toBe(fingerprint);
  });
  it("takes the pages asked for by name, and says which names no page has", () => {
    const pages = [{ name: "Home" }, { name: "Buying, declined" }, { name: "Sign in" }];
    expect(pagesNamed(pages, ["Sign in", "Buying, declined", "Account gone"])).toEqual({ pages: [pages[1], pages[2]], unknownNames: ["Account gone"] });
    expect(() => pagesNamed(pages, "Home")).toThrow("--pages takes a JSON list of page names");
    expect(() => pagesNamed(pages, [])).toThrow("--pages takes a JSON list of page names");
  });
});

describe.skipIf(!sites)("the layout check", () => {
  it("finds nothing out of line on any page, at any size or theme", async () => {
    const passed = isSkippingPassed ? onlyPassed(readMeasured(PASSED_PATH)) : null;
    const { failures, checkedCount, secondsByPage, measuredFingerprints, skippedPageNames } = (await checkPages({ ...sites!, pages, sizes: layoutRun.sizes, themes: layoutRun.themes, tiersOf: layoutRun.tiersOf, chromePath: await chromeToRun(), measured: passed, isChangedOnly: isSkippingPassed })) as { failures: Failure[]; checkedCount: number; secondsByPage: Record<string, number>; measuredFingerprints: Record<string, string>; skippedPageNames: string[] };
    if (passed) {
      mkdirSync(dirname(PASSED_PATH), { recursive: true });
      writeFileSync(PASSED_PATH, `${JSON.stringify(mergeMeasured(passed, onlyPassed(measuredFingerprints)))}\n`);
      console.log(`Skipped ${skippedPageNames.length} page(s) that passed before as they are.`);
    }
    // For PAGE_COSTS_SEC in scripts/layout-check.mjs, when the shares stop finishing together.
    console.log(`Seconds in a tab per page: ${JSON.stringify(secondsByPage)}`);
    // A skipped page sends no form, so it's one look per screen and theme.
    expect(checkedCount + skippedPageNames.length * layoutRun.sizes.length * layoutRun.themes.length).toBe(pages.length * layoutRun.sizes.length * layoutRun.themes.length);
    expect(failures.map((failure) => `${failure.page} ${failure.size} ${failure.theme}: ${failure.check}: ${failure.element}: ${failure.said}`)).toEqual([]);
  }, 900_000);

  it.skipIf(!isFirstShare)("catches a corner control off its corner, naming it", async () => {
    // The real components, then broken the way a hand-made page would be: the corner control pushed down.
    const offCorner = paneParts({ head: { words: html`<h2>Rooms</h2>`, end: secondaryButton("Refresh", { type: "button" }) }, body: html`<p>Rooms here</p>` }).html.replace('<div class="pane-head-end">', '<div class="pane-head-end" style="margin-top:30px">');
    const markup = glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "block", markup: raw(offCorner) }] }) }).html;
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    const said = failures.map((failure) => `${failure.check}: ${failure.element}`);
    expect(said.some((line) => /corner/.test(line) && /Refresh/.test(line)), said.join("\n")).toBe(true);
  }, 300_000);

  it.skipIf(!isFirstShare)("catches words inset twice, words off a control's center line, and two controls side by side outside a row", async () => {
    // The real components, then broken the way a hand-made page would be.
    const insetTwice = stack({ items: [{ kind: "words", markup: html`<p>Inset twice</p>` }] }).html.replace("<p>Inset twice</p>", '<p style="padding-left:12px">Inset twice</p>');
    const offCenter = paneParts({ head: { words: html`<h2>Versions</h2>`, end: secondaryButton("New version", { type: "button" }) }, body: html`<p>Every version</p>` }).html.replace("<h2>Versions</h2>", '<h2 style="padding-top:30px">Versions</h2>');
    const sideBySide = `<div style="display:flex;gap:8px">${secondaryButton("Keep", { type: "button" }).html}${secondaryButton("Drop", { type: "button" }).html}</div>`;
    const markup = glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "block", markup: raw(offCenter) }, { kind: "block", markup: raw(insetTwice) }, { kind: "block", markup: raw(sideBySide) }] }) }).html;
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    const said = failures.map((failure) => `${failure.check}: ${failure.element}`);
    expect(said.some((line) => /off the pane's margin/.test(line) && /Inset twice/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /off its center line/.test(line) && /Versions/.test(line)), said.join("\n")).toBe(true);
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
    const cards = () => grid({ whenEmpty: html`<p>No games here yet.</p>`, itemSize: "cover", items: ["kestrel", "verdant"].map((slug) => ({ kind: "block" as const, markup: gameCard({ title: slug === "kestrel" ? "Kestrel" : "Verdant", picture: STAND_IN_COVER_PICTURES[slug]!, href: `#${slug}`, facts: { playerCount: 12 } }) })) }).html;
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
    const card = (id: string) => notice({ placement: "over-game", id, title: "Keep your progress", body: forged(raw("<p>Sign in to keep what you've done.</p>")), isShown: true, isInPlace: true }).html;
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
  const fullPane = (body: string) => glassPane({ paneWidth: "full", body: forged(raw(body)) }).html;
  const choices = (count: number) => Array.from({ length: count }, (_, index) => ({ label: `Choice ${index + 1}`, href: "#menu" }));

  it.skipIf(!isFirstShare)("catches a pane wider than its page's shape, two panes touching, and panes over the page past their kind's size, past the screen or overflowing unscrolled", async () => {
    // The example page is a reading page (820px); a menu with 30 choices scrolls inside itself as it is, and spills when it's made not to.
    const tooWide = `<div style="width:1100px">${fullPane("<p>Wider than its shape</p>")}</div>`;
    const menu = dropdown({ id: "fixture-menu", label: "Fine menu", items: choices(30), isOpen: true }).html.replace('class="floating-pane placed-under dropdown glass in-place"', 'style="position:fixed;top:8px;left:8px" class="floating-pane placed-under dropdown glass in-place"');
    const spilling = dropdown({ id: "fixture-spill", label: "Spilling menu", items: choices(30), isOpen: true }).html.replace('class="floating-pane placed-under dropdown glass in-place"', 'style="position:fixed;top:8px;left:400px;max-height:none" class="floating-pane placed-under dropdown glass in-place"').replace('class="floating-body"', 'style="overflow:visible" class="floating-body"');
    const wideSheet = sheet({ id: "fixture-sheet", title: "Too wide", body: forged(html`<p>A sheet</p>`), closeLabel: "Close", isShown: true }).html.replace('class="sheet', 'style="width:900px;max-width:none" class="sheet');
    // Two panes set down one after the other by hand, with no layout component to put a block's gap between them.
    const touching = fullPane("<p>Touching above</p>") + fullPane("<p>Touching below</p>");
    const said = await brokenOnLaptop(tooWide + menu + spilling + wideSheet + touching);
    expect(said.some((line) => /two panes closer than a block's gap/.test(line) && /Touching below/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /wider than its page's shape/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /taller than its kind allows/.test(line) && /Spilling menu/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /a pane past the screen/.test(line)), said.join("\n")).toBe(true);
    expect(said.some((line) => /wider than its kind allows/.test(line) && /Too wide/.test(line)), said.join("\n")).toBe(true);
    // The fine menu scrolls inside itself: nothing names it.
    expect(said.filter((line) => /Fine menu|Choice 1"/.test(line) && /pane (taller|past|that overflows)/.test(line) && !/400px/.test(line)).length, said.join("\n")).toBeLessThan(2);
  }, 300_000);

  it.skipIf(!isFirstShare)("measures a gallery rule on the gallery's pages and skips it on a page in a pull request's run", async () => {
    // Words inset twice (a gallery rule), in place of a gallery page's own and of the example page's.
    const insetTwice = fullPane(stack({ items: [{ kind: "words", markup: html`<p>Inset twice</p>` }] }).html.replace("<p>Inset twice</p>", '<p style="padding-left:12px">Inset twice</p>'));
    const measuredOn = async (page: Record<string, unknown>) => {
      const { failures } = (await checkPages({ ...sites!, pages: [{ ...page, markup: insetTwice }], sizes: LAPTOP, themes: ["light"], tiersOf: RUNS.pull_request.tiersOf, chromePath: await chromeToRun() })) as { failures: Failure[] };
      return failures.filter((failure) => /off the pane's margin/.test(failure.check) && /Inset twice/.test(failure.element)).length;
    };
    expect(await measuredOn({ name: "Gallery: layout", path: "/design/layout", mainActionShows: "nowhere", isGallery: true })).toBeGreaterThan(0);
    expect(await measuredOn({ name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere" })).toBe(0);
  }, 300_000);

  it.skipIf(!isFirstShare)("catches the Laws of UX it can measure: proximity, common region, similarity and an answer within 400 ms", async () => {
    const hugging = fullPane(stack({ items: [{ kind: "block", markup: raw(table({ caption: "Rooms", columns: [{ label: "Room" }], rows: [["North"]], whenEmpty: html`<p>No rooms.</p>` }).html) }, { kind: "words", markup: html`<h2>Hugging the table</h2>` }, { kind: "words", markup: html`<p>What it names</p>` }] }).html.replace("<h2>Hugging the table</h2>", '<h2 style="margin-top:-20px;margin-bottom:30px">Hugging the table</h2>'));
    const splitGroup = fullPane(html`<p>Before</p><h2>Left alone</h2>`.html) + fullPane("<p>Its group, on another pane</p>");
    const mixedGrid = fullPane(grid({ itemSize: "card", whenEmpty: html`<p>None.</p>`, items: ["One", "Two"].map((title) => ({ kind: "block" as const, markup: glassPane({ paneWidth: "full", body: forged(html`<p>${title}</p>`) }) })) }).html.replace('<div class="grid-cell is-block">', '<div class="grid-cell is-block" style="max-width:120px">'));
    const deaf = fullPane('<button type="button" aria-controls="nothing-at-all">Answers nothing</button>');
    const said = await brokenOnLaptop(hugging + splitGroup + mixedGrid + deaf);
    for (const [check, named] of [
      [/words nearer the block before than their own/, /Hugging the table/],
      [/one group on two surfaces/, /Left alone/],
      [/one kind at different sizes/, /Two|One/],
      [/no answer within 400 ms/, /Answers nothing/],
    ] as const) expect(said.some((line) => check.test(line) && named.test(line)), `${check}\n${said.join("\n")}`).toBe(true);
  }, 300_000);
});
