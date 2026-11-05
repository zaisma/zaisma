import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STAND_IN_COVER_PICTURES } from "../../apps/site/src/generated/stand-in-placeholders.generated.ts";
import { describe, expect, it } from "vitest";
import { secondaryButton } from "../../apps/site/src/components/actions.ts";
import { glassPane } from "../../apps/site/src/components/foundations.ts";
import { raw } from "../../apps/site/src/markup.ts";
import { stack, type LayoutMarkup } from "../../apps/site/src/components/layout.ts";

/** A pane's body built by hand past the types, as a page could still forge one: these fixtures are pages the check must catch. */
const forged = (markup: { html: string }) => raw(markup.html) as unknown as LayoutMarkup;
import { dropdown } from "../../apps/site/src/components/panes.ts";
import { LAYOUT_RULE_TIERS } from "../../apps/site/src/components/layout-measure.ts";
import { MEASURED_SCREEN_NAMES, SCREEN_SIZES, TEXT_SCREEN_NAMES } from "../../apps/site/src/components/checked-pages.ts";
import layoutMeasureSource from "../../apps/site/src/components/layout-measure.ts?raw";
import layoutCheckSource from "../../scripts/layout-check.mjs?raw";
// @ts-expect-error: a Node script with no types of its own.
import { checkPages, chromeToRun, LAYOUT_CHECK_RUNS, PRESS_CHECK_SCREEN_NAME, layoutCheckShard, pageFingerprint, pagesNamed, previewSites, signIn } from "../../scripts/layout-check.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { openChrome } from "../../scripts/chrome.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { mergeMeasured, readMeasured } from "../../scripts/merge-measured.mjs";

/*
 * The measuring check (scripts/layout-check.mjs, npm run layout:check) on this checkout's preview, in headless Chrome: a run's pages
 * (LAYOUT_CHECK_RUNS: a pull request's unless LAYOUT_CHECK_RUN says sweep), with nothing out of line; and pages made to break
 * each rule, which it must catch by name. GitHub's check runs it in its own job (Layout check, .github/workflows/check.yml) with
 * LAYOUT_CHECK=1, on the preview started from a snapshot of its test data. Elsewhere it runs only on a preview that's already up, and says
 * so when there's none. LAYOUT_CHECK_SHARD="2/4" measures the second of four shares (layoutCheckShard), and the first three shares also measure
 * the pages broken on purpose. A pull request's run skips each page that passed before as it is (PASSED_PATH); LAYOUT_CHECK_FRESH=1
 * measures every page, as the merge queue's and main's runs do.
 */

const isRequired = process.env.LAYOUT_CHECK === "1";
const sites = previewSites({ isStarting: isRequired }) as { site: string; signInSite: string } | null;
if (!sites) console.log("No preview is running, so the layout check is skipped: npm run preview:start, then run this again (LAYOUT_CHECK=1 starts it).");

type Failure = { page: string; size: string; theme: string; check: string; element: string; said: string };
type LayoutRun = { pages: { name: string; isGallery?: boolean }[]; sizes: unknown[]; themes: string[]; tiersOf: (page: unknown) => string[] };
const RUNS = LAYOUT_CHECK_RUNS as Record<"pull_request" | "sweep", LayoutRun>;
const shard = process.env.LAYOUT_CHECK_SHARD;
const layoutRun = RUNS[(process.env.LAYOUT_CHECK_RUN ?? "pull_request") as keyof typeof RUNS];
/** A laptop, for the pages broken on purpose. */
const LAPTOP = [{ name: "Laptop", widthPx: 1440, heightPx: 900, isPhone: false, hasTouch: false, isRunnerChecked: true, textPercent: 100 }];
/** The first three shares' other tests, in a tab's seconds (from their runs' times beside their pages', Nov 5, 2026): they take that much fewer pages. */
const BROKEN_ON_PURPOSE_COSTS_SEC = [65, 185, 75];
const pages = (shard ? layoutCheckShard(layoutRun.pages, shard, { headStartSecByShare: BROKEN_ON_PURPOSE_COSTS_SEC }) : layoutRun.pages) as unknown[];
const isFirstShare = !shard || shard.startsWith("1/");
const isSecondShare = !shard || shard.startsWith("2/");
const isThirdShare = !shard || shard.startsWith("3/");
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
    const names = [...layoutMeasureSource.matchAll(/report\("([^"]+)"|check: "([^"$]+)"/g), ...layoutCheckSource.matchAll(/check: "([^"$]+)"/g)].map((match) => (match[1] ?? match[2])!);
    expect(names.filter((name) => !(name in LAYOUT_RULE_TIERS))).toEqual([]);
    expect(Object.keys(LAYOUT_RULE_TIERS).filter((name) => !names.includes(name))).toEqual([]);
  });

  it("are measured as each run says: a pull request's every page on two screens in light, the sweep's on the measured screens at 200% text too", () => {
    expect(Object.keys(RUNS)).toEqual(["pull_request", "sweep"]);
    expect(RUNS.pull_request.themes).toEqual(["light"]);
    expect(RUNS.pull_request.pages.some((page) => / (long names|empty|full)$/.test(page.name))).toBe(false);
    expect(RUNS.pull_request.tiersOf({ name: "Home" })).toEqual(["page"]);
    expect(RUNS.pull_request.tiersOf({ name: "Gallery: layout inside", isGallery: true })).toEqual(["page"]);
    expect(RUNS.sweep.tiersOf({ name: "Home" })).toEqual(["page", "sweep"]);
    expect(RUNS.sweep.themes).toEqual(["light"]);
    expect((RUNS.sweep.sizes as { name: string }[]).map((size) => size.name)).toEqual([...MEASURED_SCREEN_NAMES, ...TEXT_SCREEN_NAMES.map((name) => `${name} at 200% text`)]);
  });

  it("judge only what a player would notice: see, read, reach, load and press, with style held by the components", () => {
    const playerRules = Object.keys(LAYOUT_RULE_TIERS).filter((name) => !/^the (check|page) /.test(name) || /^the page scrolls/.test(name));
    expect(playerRules.sort()).toEqual([
      "a box that scrolls without its rail",
      "a control the keyboard doesn't reach", "a focused control with no visible focus", "a pane past the screen", "a pane that overflows without scrolling",
      "a picture without its placeholder", "a touch target under 44px",
      "first paint over its size", "moved after the first paint", "no answer within 400 ms", "overlaps another thing", "spills out of its pane", "the first cover below the fold",
      "the page scrolls sideways", "the runner below the fold", "two panes overlapping", "words changed after the first paint", "words cut off", "words over something with an edge",
    ]);
    expect(LAYOUT_RULE_TIERS["no answer within 400 ms"]).toBe("sweep");
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
    expect(pageFingerprint(markup("a1", "n1", "t1", "120"), page, looks, ["page", "sweep"])).not.toBe(fingerprint);
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
    const { failures, checkedCount, secondsByPage, measuredFingerprints, skippedPageNames } = (await checkPages({ ...sites!, pages, sizes: layoutRun.sizes, themes: layoutRun.themes, tiersOf: layoutRun.tiersOf, onProgress: (line: string) => process.stderr.write(`${line}\n`), chromePath: await chromeToRun(), measured: passed, isChangedOnly: isSkippingPassed })) as { failures: Failure[]; checkedCount: number; secondsByPage: Record<string, number>; measuredFingerprints: Record<string, string>; skippedPageNames: string[] };
    if (passed) {
      mkdirSync(dirname(PASSED_PATH), { recursive: true });
      writeFileSync(PASSED_PATH, `${JSON.stringify(mergeMeasured(passed, onlyPassed(measuredFingerprints)))}\n`);
      console.log(`Skipped ${skippedPageNames.length} page(s) that passed before as they are.`);
    }
    // For the page costs in scripts/layout-check.mjs, when the shares stop finishing together.
    console.log(`Seconds in a tab per page: ${JSON.stringify(secondsByPage)}`);
    // A skipped page sends no form, so it's one look per screen and theme.
    const looksOf = (page: { name: string }) => { const only = (page as { screenNames?: string[] }).screenNames; return (only ? (layoutRun.sizes as { name: string }[]).filter((size) => only.includes(size.name)).length : layoutRun.sizes.length) * layoutRun.themes.length; };
    const sumOfLooks = (some: { name: string }[]) => some.reduce((sum, page) => sum + looksOf(page), 0);
    const listed = pages as { name: string }[];
    expect(checkedCount + sumOfLooks(listed.filter((page) => skippedPageNames.includes(page.name)))).toBe(sumOfLooks(listed));
    expect(failures.map((failure) => `${failure.page} ${failure.size} ${failure.theme}: ${failure.check}: ${failure.element}: ${failure.said}`)).toEqual([]);
  }, 900_000);

  // Each new rule, on a laptop: a fixture built to break it, and its fixed twin beside it, which it must pass.
  const brokenOnLaptop = async (markup: string) => {
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    return failures.map((failure) => `${failure.check}: ${failure.element}: ${failure.said}`);
  };
  const fullPane = (body: string) => glassPane({ paneWidth: "full", body: forged(raw(body)) }).html;
  const choices = (count: number) => Array.from({ length: count }, (_, index) => ({ label: `Choice ${index + 1}`, href: "#menu" }));

  it.skipIf(!isFirstShare)("measures each page as its own first visit, whatever the page before it fetched ahead", async () => {
    // A game's page has Browse's link on a phone's screen, so it fetches /games ahead, under Chrome's own name: a computer's page, which the
    // browser may keep for half a minute. Answered from there, Browse would draw itself again for the phone after its first paint.
    const pagesInOrder = ["Game page", "Games"].map((name) => layoutRun.pages.find((page) => page.name === name));
    const { failures } = (await checkPages({ ...sites!, pages: pagesInOrder, sizes: SCREEN_SIZES.filter((size) => size.name === "Phone"), themes: ["light"], tabCount: 1, chromePath: await chromeToRun() })) as { failures: Failure[] };
    expect(failures).toEqual([]);
  }, 300_000);

  it.skipIf(!isFirstShare)("keeps an account's Continue playing on the home while its played list is on its way", async () => {
    const chrome = await openChrome(await chromeToRun(), "zaisma-layout-", { isDrawingOnCpu: true });
    try {
      const { browserContextId } = await chrome.send("Target.createBrowserContext");
      await signIn(chrome, browserContextId, sites!.site, "Many_Things");
      const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId });
      const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method: string, params = {}) => chrome.send(method, params, sessionId);
      // The list is asked for after the shelf is first filled, and never answered here, so this is what a slow connection shows until it comes.
      const isAsked = new Promise<void>((done) => chrome.listen(sessionId, (method: string) => { if (method === "Fetch.requestPaused") done(); }));
      await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/me/played", requestStage: "Request" }] });
      await send("Page.navigate", { url: `${sites!.site}/` });
      await isAsked;
      const { result } = await send("Runtime.evaluate", { expression: `document.getElementById("home-continue").hidden`, returnByValue: true });
      expect(result.value).toBe(false);
    } finally {
      await chrome.close();
    }
  }, 300_000);

  it.skipIf(!isFirstShare)("catches a sheet on a page with no button on the Screens bench, and passes one with its own", async () => {
    const failures = await brokenOnLaptop(`<dialog class="sheet" id="sheet-with-no-button"></dialog><dialog class="sheet" id="share-dialog"></dialog>`);
    expect(failures.filter((failure) => failure.includes("no button on the Screens bench"))).toEqual([expect.stringContaining("#sheet-with-no-button")]);
  });

  it.skipIf(!isFirstShare)("catches panes over the page past the screen or overflowing unscrolled, and passes one that scrolls inside itself", async () => {
    // A menu with 30 choices scrolls inside itself as it is, and spills when it's made not to.
    const menu = dropdown({ id: "fixture-menu", label: "Fine menu", items: choices(30), isOpen: true }).html.replace('class="floating-pane placed-under dropdown glass in-place"', 'style="position:fixed;top:8px;left:8px" class="floating-pane placed-under dropdown glass in-place"');
    const spilling = dropdown({ id: "fixture-spill", label: "Spilling menu", items: choices(30), isOpen: true }).html.replace('class="floating-pane placed-under dropdown glass in-place"', 'style="position:fixed;top:8px;left:400px;max-height:none" class="floating-pane placed-under dropdown glass in-place"');
    const said = await brokenOnLaptop(menu + spilling);
    expect(said.some((line) => /a pane past the screen|a pane that overflows without scrolling/.test(line) && /Spilling menu/.test(line)), said.join("\n")).toBe(true);
    expect(said.filter((line) => /Fine menu/.test(line) && /pane (past|that overflows)/.test(line)), said.join("\n")).toEqual([]);
  }, 300_000);

  it.skipIf(!isFirstShare)("catches a press that answers nothing within 400 ms, in the sweep", async () => {
    const deaf = fullPane('<button type="button" aria-controls="nothing-at-all">Answers nothing</button>');
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup: deaf };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: RUNS.sweep.sizes.filter((size) => (size as { name: string }).name === PRESS_CHECK_SCREEN_NAME), themes: ["light"], tiersOf: RUNS.sweep.tiersOf, chromePath: await chromeToRun() })) as { failures: Failure[] };
    expect(failures.some((failure) => /no answer within 400 ms/.test(failure.check) && /Answers nothing/.test(failure.element)), failures.map((failure) => `${failure.check}: ${failure.element}`).join("\n")).toBe(true);
  }, 300_000);

  it.skipIf(!isFirstShare)("catches a control with no focus showing, and passes a real button beside it", async () => {
    const said = await brokenOnLaptop(fullPane(stack({ items: [{ kind: "block", markup: forged(raw('<div tabindex="0" style="outline:none">Quiet focus</div>')) }, { kind: "control", markup: secondaryButton("Shows its focus", { type: "button" }) }] }).html));
    expect(said.some((line) => /a focused control with no visible focus/.test(line) && /Quiet focus/.test(line)), said.join("\n")).toBe(true);
    expect(said.filter((line) => /Shows its focus/.test(line)), said.join("\n")).toEqual([]);
  }, 300_000);

  it.skipIf(!isFirstShare)("catches a control the keyboard can't reach past one that holds Tab", async () => {
    const markup = fullPane('<div id="holds-tab" tabindex="0">Holds Tab</div><button type="button">Past the hold</button>');
    // The page's policy refuses inline handlers: the hold is added the way a page's own script would add it.
    const setUp = `document.getElementById("holds-tab").addEventListener("keydown", (event) => { if (event.key === "Tab") event.preventDefault(); }); true`;
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup, setUp };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    const unreached = failures.filter((failure) => failure.check === "a control the keyboard doesn't reach");
    expect(unreached.some((failure) => /Past the hold/.test(failure.element)), failures.map((failure) => `${failure.check}: ${failure.element}: ${failure.said}`).join("\n")).toBe(true);
  }, 300_000);

  it.skipIf(!isFirstShare)("catches a page that loads more by itself after its first paint, however late its answer comes", async () => {
    // Its answer comes well after the page has settled, counted in frames, and only the wait for what's on its way sees it.
    const scriptOnNewDocument = `if (window === top) addEventListener("load", () => {
      const holder = document.createElement("div");
      holder.setAttribute("data-loads-on-scroll", "");
      holder.innerHTML = '<a href="#next" aria-busy="true"></a>';
      document.body.append(holder);
      let framesLeft = 90;
      const frame = () => {
        if (--framesLeft > 0) return requestAnimationFrame(frame);
        const late = document.createElement("div");
        late.style.height = "400px";
        late.textContent = "Late page of covers";
        document.querySelector("main").append(late);
        holder.querySelector("a").removeAttribute("aria-busy");
      };
      requestAnimationFrame(frame);
    })`;
    const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", scriptOnNewDocument };
    const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], tiersOf: () => ["page"], chromePath: await chromeToRun() })) as { failures: Failure[] };
    expect(failures.some((failure) => failure.check === "moved after the first paint" && /Late page of covers/.test(failure.element)), failures.map((failure) => `${failure.check}: ${failure.element}`).join("\n")).toBe(true);
  }, 300_000);

  // On Desktop the whole of Browse fits its screen, More games and the footer on it; on a laptop they're a screen below it.
  it.each((["Desktop", "Laptop"] as const).filter((screenName) => (screenName === "Desktop" ? isSecondShare : isThirdShare)))("leaves Browse as it first painted on %s until the player moves, and then loads as it nears the screen", async (screenName) => {
    const size = SCREEN_SIZES.find((each) => each.name === screenName)!;
    const chrome = await openChrome(await chromeToRun(), "zaisma-layout-", { isDrawingOnCpu: true });
    try {
      const { browserContextId } = await chrome.send("Target.createBrowserContext");
      const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId });
      const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method: string, params = {}) => chrome.send(method, params, sessionId);
      const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
      await send("Page.enable");
      await send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await send("Emulation.setDeviceMetricsOverride", { width: size.widthPx, height: size.heightPx, deviceScaleFactor: 1, mobile: false });
      const loaded = new Promise<void>((done) => chrome.listen(sessionId, (method: string) => { if (method === "Page.loadEventFired") done(); }));
      let askedRequestId: string | null = null, onAsked = () => {};
      chrome.listen(sessionId, (method: string, params: { requestId: string }) => { if (method === "Fetch.requestPaused") { askedRequestId = params.requestId; onAsked(); } });
      await send("Fetch.enable", { patterns: [{ urlPattern: "*/games?page=2", requestStage: "Request" }] });
      await send("Page.navigate", { url: `${sites!.site}/games` });
      await loaded;
      // Once its script is watching, and a watcher of the same reach has had its first answer: an old Load more would be pressed by now, and busy.
      const isNear = await evaluate(`(async () => {
        while (!window.zaismaLoadMore) await new Promise((done) => requestAnimationFrame(done));
        const holder = document.querySelector("[data-loads-on-scroll]");
        const isNear = await new Promise((done) => new IntersectionObserver((entries, observer) => { observer.disconnect(); done(entries[0].isIntersecting); }, { rootMargin: "100% 0px" }).observe(holder));
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        return isNear;
      })()`);
      expect(isNear).toBe(true);
      expect(await evaluate(`document.querySelector("[data-loads-on-scroll] a").getAttribute("aria-busy")`)).toBe(null);
      expect(askedRequestId).toBe(null);
      const asked = new Promise<void>((done) => { onAsked = done; });
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 100, y: 100, deltaX: 0, deltaY: 100 });
      await asked;
      await send("Fetch.continueRequest", { requestId: askedRequestId });
      const coverCount = await evaluate(`(async () => {
        const count = () => document.querySelectorAll("#browse-games > *, #browse-other-games > *").length;
        while (count() <= 48) await new Promise((done) => requestAnimationFrame(done));
        return count();
      })()`);
      expect(coverCount).toBeGreaterThan(48);
    } finally {
      await chrome.close();
    }
  }, 300_000);

  describe("controls that arrive while Tab goes round", () => {
    // New controls added the way the next page of a long list arrives: past what the check counted when it started.
    const addArrivals = `(count, label, list) => { for (let index = 0; index < count; index++) { const control = document.createElement("button"); control.type = "button"; control.textContent = label + " " + index; list.append(control); } }`;
    const onTab = async (markup: string, setUp: string, more: Record<string, unknown> = {}) => {
      const page = { name: "Broken on purpose", path: "/design/example", mainActionShows: "nowhere", markup: fullPane(markup), setUp: `const addArrivals = ${addArrivals}; ${setUp}; true`, ...more };
      const { failures } = (await checkPages({ ...sites!, pages: [page], sizes: LAPTOP, themes: ["light"], chromePath: await chromeToRun() })) as { failures: Failure[] };
      return failures.map((failure) => `${failure.check}: ${failure.element}: ${failure.said}`);
    };
    const reachRules = (said: string[]) => said.filter((line) => /keyboard|focused control|couldn't measure/.test(line));

    it.skipIf(!isSecondShare)("reaches what's past a list when its next page arrives ahead of focus, with Load more swapped for the next one", async () => {
      const markup = '<button type="button" id="before-list">Before the list</button><div id="list"></div><div id="load-more"><a href="#old">Old Load more</a></div><button type="button">Past the list</button>';
      const said = await onTab(markup, `document.getElementById("before-list").addEventListener("focus", () => { addArrivals(20, "Arrived", document.getElementById("list")); document.getElementById("load-more").innerHTML = '<a href="#new">New Load more</a>'; }, { once: true })`);
      expect(reachRules(said), said.join("\n")).toEqual([]);
    }, 300_000);

    it.skipIf(!isSecondShare)("catches one that arrives past a control that holds Tab", async () => {
      const markup = '<div id="holds-tab" tabindex="0">Holds Tab</div><div id="list"></div>';
      const said = await onTab(markup, `const hold = document.getElementById("holds-tab"); hold.addEventListener("keydown", (event) => { if (event.key === "Tab") event.preventDefault(); }); hold.addEventListener("focus", () => addArrivals(1, "Arrived past the hold", document.getElementById("list")), { once: true })`);
      expect(said.some((line) => /a control the keyboard doesn't reach/.test(line) && /Arrived past the hold/.test(line)), said.join("\n")).toBe(true);
    }, 300_000);

    it.skipIf(!isSecondShare)("goes round again for what arrives behind focus, and holds it to the same look", async () => {
      // Its own cell, so its look at rest isn't read with the focused button beside it.
      const markup = '<div id="list" class="stack-cell"></div><button type="button" id="past-list">Past the list</button>';
      const said = await onTab(markup, `document.getElementById("past-list").addEventListener("focus", () => { const quiet = document.createElement("div"); quiet.tabIndex = 0; quiet.style.outline = "none"; quiet.textContent = "Quiet arrival"; document.getElementById("list").append(quiet); }, { once: true })`);
      expect(said.some((line) => /a focused control with no visible focus/.test(line) && /Quiet arrival/.test(line)), said.join("\n")).toBe(true);
    }, 300_000);

    it.skipIf(!isSecondShare)("waits for a load on its way when focus is back where it began", async () => {
      // Nothing comes until focus has gone round: the answer is asked for only then, as a slow connection brings it after the walk.
      const markup = '<div id="list"></div><div data-loads-on-scroll><button type="button" id="load" aria-busy="true">Waiting load</button></div>';
      const said = await onTab(markup, `let first = null; document.addEventListener("focusin", (event) => { if (!first) { first = event.target; return; } if (event.target !== first) return; first = document.body; fetch(location.href).then(() => { const quiet = document.createElement("div"); quiet.tabIndex = 0; quiet.style.outline = "none"; quiet.textContent = "Late arrival"; document.getElementById("list").append(quiet); document.getElementById("load").removeAttribute("aria-busy"); }); })`);
      expect(said.some((line) => /a focused control with no visible focus/.test(line) && /Late arrival/.test(line)), said.join("\n")).toBe(true);
    }, 300_000);

    it.skipIf(!isSecondShare)("says so when a page never stops adding controls, past the most it will count", async () => {
      const markup = '<button type="button" id="seed">Seed</button><div id="list"></div>';
      const said = await onTab(markup, `const list = document.getElementById("list"); document.getElementById("seed").addEventListener("focus", () => addArrivals(1, "Endless", list), { once: true }); list.addEventListener("focusin", () => addArrivals(1, "Endless", list))`, { maximumArrivedControlCount: 12 });
      expect(said.some((line) => /the check couldn't measure the page/.test(line) && /kept adding controls/.test(line)), said.join("\n")).toBe(true);
    }, 300_000);
  });
});
