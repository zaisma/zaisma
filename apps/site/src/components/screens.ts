import { html, type Raw } from "../markup.ts";
import { pageScript, pageScriptPath } from "../page-scripts.ts";
import { component } from "./component.ts";
import { glassPane, tag } from "./foundations.ts";
import { sheet } from "./panes.ts";
import { cutButton, runButton, textLink } from "./actions.ts";
import { cutField } from "./inputs.ts";
import { checkField } from "./choices.ts";
import { grid, paneParts, row, stack } from "./layout.ts";
import { MEASURE_LAYOUT_SOURCE } from "./layout-measure.ts";
import { CHECKED_PAGES, LOCAL_SCREEN_NAMES, SCREEN_SIZES, SCREEN_THEMES, type CheckedPage, type ScreenName, type StepToTake, UNIQUE_WORD } from "./checked-pages.ts";

/** Zaisma's branches, in the order Screens shows them. */
const AREAS: CheckedPage["area"][] = ["Playing", "Signing in", "Developers", "Gallery"];

/*
 * Screens: one page on Julius's phone and a laptop (or any of the seven screens the check measures), light and dark, side by side, each measured by the layout check. It's where a
 * page's look is reviewed, never made: AI builds pages from the components and the layout, the check holds them to the rules, and a
 * person judges what they see here. Pointing at anything in a screen says what it is and which rule placed it, so feedback names the
 * rule (a token, an option, a check) and holds on every page. The Screens page is /design/screens?page=…, on a local preview only.
 */

export const SCREENS_PATH = "/design/screens";
export const screensHref = (paths: string[]): string => `${SCREENS_PATH}?${paths.map((path) => `page=${encodeURIComponent(path)}`).join("&")}`;
/** Screens showing one state on the checks' list by its name (checked-pages.ts), forms sent and all. */
export const screensStateHref = (name: string): string => `${SCREENS_PATH}?state=${encodeURIComponent(name)}`;

/** A path on this site (never another site's address), as the Screens page takes it. */
export const isSitePath = (path: string): boolean => /^\/(?![/\\])/.test(path);

export interface ScreensOptions {
  /** The page shown: a path on this site. A gallery group with its #component works too. */
  path: string;
  /** What it's called, for its frames' titles. */
  title: string;
  /** Taken in each screen once its page loads, to show a state only forms and links reach (checked-pages.ts). */
  stepsToTake?: readonly StepToTake[];
  /** The screens it's shown on (checked-pages.ts's SCREEN_SIZES, by name): a phone and a laptop when left out. */
  screenNames?: readonly ScreenName[];
  /** The Screens page's own address, to come back to after signing in when the page needs an account. */
  screensPath?: string;
  /** The test account a state is seen as (checked-pages.ts): the screens show whoever this browser is signed in as, so its pane says who. */
  account?: string;
}

/** The screens asked for in the address (?screen=, more than once for several), as the check names them; a phone and a laptop when none is. */
export const screenNamesOf = (url: URL): ScreenName[] => {
  const asked = url.searchParams.getAll("screen").flatMap((name) => SCREEN_SIZES.filter((screenSize) => screenSize.name === name).map((screenSize) => screenSize.name));
  return asked.length ? asked : [...LOCAL_SCREEN_NAMES];
};

/** The measuring check, as a script each screen puts in its page to run once it has drawn (scripts/layout-check.mjs runs the same). */
export const LAYOUT_MEASURE_SCRIPT = pageScript("layout-measure", `window.zaismaMeasureLayout = ${MEASURE_LAYOUT_SOURCE};`);

/** One page on its screens, the widest first, light over dark, each with what the measuring check finds under it. */
export function screens(options: ScreensOptions): Raw {
  const names = options.screenNames ?? LOCAL_SCREEN_NAMES;
  const shownSizes = [...SCREEN_SIZES].reverse().filter((screenSize) => names.includes(screenSize.name));
  const shown = SCREEN_THEMES.flatMap((theme) => shownSizes.map((screenSize) => ({ theme, screenSize })));
  // One sheet for the page's screens, which Larger fills with the screen pressed.
  const largeId = `${options.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-screen-large`;
  return html`<div class="screens" data-screens${options.stepsToTake ? html` data-steps-to-take="${JSON.stringify(options.stepsToTake)}"` : ""} data-measure-script="${pageScriptPath(LAYOUT_MEASURE_SCRIPT)}" data-inspect-script="${pageScriptPath(LAYOUT_INSPECT_SCRIPT)}"><div class="screens-in">${shown.map(({ theme, screenSize }) => {
    const name = `${screenSize.name}, ${theme}`;
    return html`<figure class="screen" data-screen data-width-px="${String(screenSize.widthPx)}" data-height-px="${String(screenSize.heightPx)}" data-screen-theme="${theme}">
<div class="screen-view" data-cut-line="0"><iframe src="${options.path}" title="${options.title}: ${name}" width="${String(screenSize.widthPx)}" height="${String(screenSize.heightPx)}" loading="lazy"></iframe><div class="screen-pointer" hidden></div></div>
<figcaption class="screen-caption"><span>${name} · ${String(screenSize.widthPx)} × ${String(screenSize.heightPx)}</span><span data-screen-verdict>${tag("Measuring", "count")}</span>${cutButton(`${name}, larger`, { type: "button", icon: "full-screen", isLabelHidden: true, isSmall: true, controls: largeId })}</figcaption>
<ul class="screen-problems" data-screen-problems hidden></ul>
<p class="screen-pointed" data-screen-pointed hidden></p>
</figure>`;
  })}</div>${sheet({ id: largeId, title: options.title, body: html`<div class="screen-large" data-screen-large></div>`, closeLabel: "Close", isPicture: true })}</div>`;
}

/** The Screens page's first pane: what it is, the pages the check measures in Zaisma's branches, and any page to show, on the screens picked. */
export function screensPicker(path: string, screenNames: readonly ScreenName[] = LOCAL_SCREEN_NAMES): Raw {
  const ownPages = CHECKED_PAGES.filter((page) => !page.isOnSignInSite && !page.isOffScreens && !page.path.startsWith(SCREENS_PATH));
  return glassPane({
    paneWidth: "full",
    label: "Pick a page",
    body: stack({
      items: [
        { kind: "words", markup: html`<p>A page on the screens you pick, a phone and a laptop to start, light and dark, each measured by the layout check. Point at or tap anything in a screen to see what it is and what placed it.</p>` },
        // The pages the check measures, in Zaisma's branches: each branch's name over its pages.
        {
          kind: "block",
          markup: grid({ whenEmpty: html`<p>No pages are measured yet.</p>`,
            itemSize: "card",
            label: "Pages the check measures",
            items: AREAS.filter((area) => ownPages.some((page) => page.area === area)).map((area) => ({
              kind: "block" as const,
              markup: stack({
                label: area,
                items: [
                  { kind: "words", markup: html`<p><strong>${area}</strong></p>` },
                  { kind: "words", markup: row({ widths: "fit", items: ownPages.filter((page) => page.area === area).map((page) => ({ kind: "words" as const, markup: textLink(page.name.replace(/^Gallery: (.)/, (_, first: string) => first.toUpperCase()), screensStateHref(page.name)) })) }) },
                ],
              }),
            })),
          }),
        },
        {
          kind: "block",
          markup: html`<form method="get" action="${SCREENS_PATH}">${stack({
            items: [
              { kind: "words", markup: html`<h2>On these screens</h2>` },
              { kind: "block", markup: grid({ itemSize: "figure", label: "Screens", items: SCREEN_SIZES.map((screenSize) => ({ kind: "block" as const, markup: checkField({ id: `screens-screen-${screenSize.name.toLowerCase().replace(/ /g, "-")}`, name: "screen", checkValue: screenSize.name, label: `${screenSize.name}, ${screenSize.widthPx} × ${screenSize.heightPx}`, isChecked: screenNames.includes(screenSize.name) }) })) }) },
              { kind: "words", markup: html`<h2>The page</h2>` },
              { kind: "block", markup: row({ widths: "lead-fills", items: [{ kind: "control", markup: cutField({ id: "screens-page", name: "page", label: "Page", type: "text", icon: "globe", text: path, placeholder: "/signin" }) }, { kind: "control", markup: runButton("Show", { type: "submit" }) }] }) },
            ],
          })}</form>`,
        },
      ],
    }),
  });
}

/** A page on the four screens, in a pane with its name, its path and a way to open it alone. */
export function screensPane(options: ScreensOptions): Raw {
  return glassPane({
    paneWidth: "full",
    label: options.title,
    body: paneParts({ head: { words: html`<h2>${options.title}</h2><p>${options.path}</p>
${options.account ? html`<p>Seen as ${options.account}: the screens show whoever this browser is signed in as.</p>` : ""}
<p data-screens-signed-out hidden>It needs an account, and the screens show it as this browser sees it, signed out. ${textLink(options.account ? `Sign in as ${options.account}` : "Sign in", `/signin?next=${encodeURIComponent(options.screensPath ?? SCREENS_PATH)}`)} to see it.</p>`, end: cutButton("Open it", { href: options.path }) }, body: screens(options) }),
  });
}

/**
 * What placed a thing, as a script any page can load (Screens puts it in each screen's page, and the preview's feedback overlay calls
 * it): window.zaismaInspect(element) answers { component, label, layoutRule, element } for the component under it (null for words of a
 * page's own), its words, what placed it (its size class, its layout's gap and why, its pane's width and margins), and the element to
 * outline. Any /js/layout-inspect.<hash>.js address serves it.
 */
export const LAYOUT_INSPECT_SCRIPT = pageScript("layout-inspect", String.raw`(function () {
  var COMPONENTS = { "run-wrap": "Runner button", "cut-btn": "Cut button", "glass-btn": "Glass button", "guest-btn": "Guest button", "text-btn": "Text button", "cut-field": "Field", "field": "Field", "find": "Search", "tab-switch": "Switch", "steps": "Row arrows", "cover": "Cover", "banner": "Banner", "table": "Table", "list-rows": "List rows", "choice-card": "Choice card", "toggle": "Toggle", "check": "Check", "shelf": "Shelf", "tag": "Tag", "link": "Text link", "glass-pane": "Glass pane", "tray": "Tray", "sheet": "Sheet", "top": "Header", "foot": "Footer" };
  var GAPS = { "words-words": "words next to words", "words-control": "words next to a control", "control-stack": "two controls, one over the other", "control-row-boxes": "two controls side by side, their slants overlapping", "block-block": "a block next to anything" };
  function componentOf(el, cell) {
    for (var walk = el; walk && walk !== cell && walk.classList; walk = walk.parentElement) {
      for (var name in COMPONENTS) if (walk.classList.contains(name)) return { el: walk, name: COMPONENTS[name] };
    }
    return null;
  }
  // A token's length, worked out: a probe in the page takes it as its margin for a moment.
  function lengthPx(token) {
    var probe = document.createElement("div"); probe.style.cssText = "position:absolute;visibility:hidden;margin-left:var(" + token + ")"; document.body.append(probe);
    var found = parseFloat(getComputedStyle(probe).marginLeft); probe.remove(); return Math.round(found * 10) / 10;
  }
  function px(token) { var found = lengthPx(token); return found < 0 ? -found + "px overlap" : found + "px"; }
  var SIZES = ["small", "regular", "field", "big"];
  function sizeOf(el) {
    var face = (el.matches(".run-wrap, .cut-btn") ? el.querySelector(".face") : el.querySelector(".field")) || el, height = parseFloat(getComputedStyle(face).height);
    var named = SIZES.find(function (name) { return Math.abs(lengthPx("--control-height-" + name) - height) < 1; });
    return height ? Math.round(height) + "px tall" + (named ? " (" + named + ")" : "") : "";
  }
  function gapOf(cell, prefix) { var found = Array.prototype.find.call(cell.classList, function (name) { return name.indexOf(prefix) === 0; }); return found ? found.slice(prefix.length) : ""; }
  window.zaismaInspect = function (target) {
    var cell = target.closest(".stack-cell, .row-cell, .grid-cell"), thing = componentOf(target, cell ? cell.parentElement : null), said = [];
    var el = thing ? thing.el : cell || target;
    var label = (el.getAttribute("aria-label") || el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 32);
    var kind = cell ? (cell.classList.contains("is-words") ? "words" : cell.classList.contains("is-control") ? "a control" : "a block") : "";
    var sizeWords = thing && kind === "a control" ? sizeOf(thing.el) : "";
    if (sizeWords) said.push(sizeWords);
    if (cell && cell.classList.contains("stack-cell")) {
      var above = gapOf(cell, "gap-top-");
      said.push(above ? "Stack: " + px("--gap-" + above) + " above it, " + GAPS[above] + " (--gap-" + above + ")" : "Stack: first, at the top");
    } else if (cell && cell.classList.contains("row-cell")) {
      var after = cell.nextElementSibling ? gapOf(cell, "gap-end-") : "";
      said.push("Row, " + (cell.classList.contains("fills") ? "filling" : "fitting its words") + (after ? ": " + px("--gap-" + after) + " after it, " + GAPS[after] + " (--gap-" + after + ")" : ""));
    } else if (cell) said.push("Grid: a cell of " + (Array.prototype.find.call(cell.parentElement.classList, function (name) { return name.indexOf("item-") === 0; }) || "item-").slice(5) + "s");
    var pane = el.closest(".glass-pane, .tray, .sheet");
    if (pane && pane !== el) {
      said.push((pane.classList.contains("fit") ? "In a pane that fits what's in it" : pane.classList.contains("glass-pane") ? "In a full-width pane" : "On a " + (pane.classList.contains("tray") ? "tray" : "sheet")) +
        (kind === "words" ? ": keeps the words' margin, " + px("--pad-pane") + " (--pad-frame and --pad-words)" : ": at the frame gap, " + px("--pad-frame") + " (--pad-frame)"));
    }
    return { component: thing ? thing.name : null, label: label, layoutRule: said.length ? said.join(" · ") : null, element: el };
  };
})();
`);

/**
 * The screens' script. Each frame is scaled to fit its cell at its screen's size (its own window keeps that size, so its media queries
 * and the measuring check see the screen's), takes its light or dark once loaded (data-theme-choice, which the page's theme script
 * follows), then runs the measuring check in the page and shows what it found. Pointing at anything in a frame outlines the component
 * under the pointer and says what it is and what placed it (LAYOUT_INSPECT_SCRIPT, in the frame's page).
 */
export const SCREENS_SCRIPT = pageScript("screens", String.raw`(function () {
  // One of the site's scripts, put in a screen's page once.
  function loaded(doc, src, done) {
    if (doc.querySelector('script[src="' + src + '"]')) return done();
    var script = doc.createElement("script"); script.src = src; script.onload = done; doc.head.append(script);
  }
  // A state only forms and links reach (checked-pages.ts): each step is taken in a frame once its page is there, and ready(doc) runs on the
  // last one's answer, or with what went wrong.
  function stepsOf(figure) { var holder = figure.closest("[data-screens]").dataset; return holder.stepsToTake ? JSON.parse(holder.stepsToTake) : []; }
  function stepThrough(frame, steps, ready) {
    var stepIndex = 0;
    frame.addEventListener("load", function () {
      var doc = null; try { doc = frame.contentDocument; } catch (error) {}
      if (!doc || !doc.documentElement) return ready(null, "Not a page on this site");
      if (stepIndex >= steps.length) return ready(doc, null);
      var step = steps[stepIndex++];
      if (step.path) { frame.contentWindow.location.assign(step.path); return; }
      var found = Array.prototype.find.call(doc.querySelectorAll("form"), function (each) { return each.getAttribute("action") === step.formAction; });
      if (!found) return ready(null, "Couldn't send the form for " + step.formAction);
      var word = Math.random().toString(36).slice(2, 10);
      Object.keys(step.fieldValues).forEach(function (name) {
        var field = found.elements.namedItem(name);
        if (!field) { field = doc.createElement("input"); field.type = "hidden"; field.name = name; found.append(field); }
        field.value = step.fieldValues[name].split(${JSON.stringify(UNIQUE_WORD)}).join(word);
      });
      // As a browser without the page's scripts would send it (checked-pages.ts, FormToSend): its answer loads whole, and measures.
      HTMLFormElement.prototype.submit.call(found);
    });
  }
  document.querySelectorAll("[data-screen]").forEach(function (figure) {
    var view = figure.querySelector(".screen-view"), frame = view.querySelector("iframe"), pointer = view.querySelector(".screen-pointer");
    var verdict = figure.querySelector("[data-screen-verdict]"), problems = figure.querySelector("[data-screen-problems]"), pointed = figure.querySelector("[data-screen-pointed]");
    var widthPx = Number(figure.dataset.widthPx), heightPx = Number(figure.dataset.heightPx), theme = figure.dataset.screenTheme, scale = 1;
    var scripts = figure.closest("[data-screens]").dataset;
    function fit() { scale = Math.min(1, view.clientWidth / widthPx); frame.style.transform = "scale(" + scale + ")"; view.style.height = Math.round(heightPx * scale) + "px"; }
    fit(); window.zaismaWatch.size(view, fit);
    function found(failures) {
      verdict.textContent = "";
      var mark = document.createElement("span"); mark.className = "tag " + (failures.length ? "warning" : "new"); mark.textContent = failures.length ? failures.length + " out of line" : "Nothing out of line"; verdict.append(mark);
      problems.replaceChildren.apply(problems, failures.map(function (failure) { var item = document.createElement("li"); item.textContent = failure.check + ": " + failure.element + ", " + failure.said; return item; }));
      problems.hidden = !failures.length;
    }
    // What's pointed at shows under its screen only while something is: the page says once, at its top, that pointing tells you.
    function hide() { pointer.hidden = true; pointed.hidden = true; }
    stepThrough(frame, stepsOf(figure), ready);
    function ready(doc, problem) {
      if (!doc) { verdict.textContent = problem; return; }
      // A page that needs an account sends a signed-out browser to sign in: its pane says so once, with the way to sign in and come back.
      if (frame.contentWindow.location.pathname === "/signin" && new URL(frame.getAttribute("src"), location.href).pathname !== "/signin") {
        figure.closest(".glass-pane").querySelector("[data-screens-signed-out]").hidden = false;
      }
      var inside = frame.contentWindow;
      doc.documentElement.setAttribute("data-theme-choice", theme);
      frame.classList.add("is-shown");
      loaded(doc, scripts.measureScript, function () {
        (doc.fonts ? doc.fonts.ready : Promise.resolve()).then(function () { setTimeout(function () { found(inside.zaismaMeasureLayout({ isMainActionChecked: false, isTouch: inside.matchMedia("(pointer: coarse)").matches })); }, 600); });
      });
      loaded(doc, scripts.inspectScript, function () {
        // Pointed at with a mouse, or tapped on a touch screen.
        ["pointermove", "pointerdown"].forEach(function (kind) { doc.addEventListener(kind, function (event) {
          if (!event.target.closest) return;
          var at = inside.zaismaInspect(event.target), r = at.element.getBoundingClientRect();
          pointer.hidden = false;
          pointer.style.left = r.left * scale + "px"; pointer.style.top = r.top * scale + "px"; pointer.style.width = r.width * scale + "px"; pointer.style.height = r.height * scale + "px";
          pointed.hidden = false;
          pointed.textContent = [(at.component || "Words") + (at.label ? ' "' + at.label + '"' : ""), at.layoutRule].filter(Boolean).join(" · ");
        }, { passive: true }); });
        doc.documentElement.addEventListener("mouseleave", hide);
      });
    }
  });
  // Larger: the screen's page again, live, in a picture's sheet, at the screen's own size scaled to all the room the sheet has in the window.
  var EDGE_PX = 24, shownLarge = null;
  // The sheet as wide as it goes for a moment gives the room across, and what's left of the window's height under its head the room down;
  // the screen is scaled to fit both, and the sheet fits it again. Again whenever the window changes.
  function fitLarge() {
    if (!shownLarge || !shownLarge.sheet.open) return;
    var large = shownLarge.sheet, box = shownLarge.box;
    box.style.width = ""; box.style.height = "0px"; large.style.width = "100%";
    var tallestPx = Math.min(window.innerHeight - 2 * EDGE_PX, parseFloat(getComputedStyle(large).maxHeight) || Infinity);
    var scale = Math.min(box.clientWidth / shownLarge.widthPx, (tallestPx - large.offsetHeight) / shownLarge.heightPx, 2);
    large.style.width = "";
    box.style.width = Math.floor(shownLarge.widthPx * scale) + "px"; box.style.height = Math.floor(shownLarge.heightPx * scale) + "px"; shownLarge.frame.style.transform = "scale(" + scale + ")";
  }
  window.addEventListener("resize", fitLarge);
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest(".screen-caption [aria-controls]");
    if (!button) return;
    var figure = button.closest("[data-screen]"), large = document.getElementById(button.getAttribute("aria-controls")), box = large && large.querySelector("[data-screen-large]");
    if (!box) return;
    var widthPx = Number(figure.dataset.widthPx), heightPx = Number(figure.dataset.heightPx), small = figure.querySelector(".screen-view > iframe");
    large.querySelector(".sheet-title").textContent = small.title;
    var frame = document.createElement("iframe"); frame.title = small.title; frame.width = String(widthPx); frame.height = String(heightPx);
    box.replaceChildren(frame);
    shownLarge = { sheet: large, box: box, frame: frame, widthPx: widthPx, heightPx: heightPx };
    // Once it's open.
    setTimeout(fitLarge);
    stepThrough(frame, stepsOf(figure), function (doc) { if (doc) doc.documentElement.setAttribute("data-theme-choice", figure.dataset.screenTheme); frame.classList.add("is-shown"); });
    frame.src = small.getAttribute("src");
  });
  // Closed, the page in it goes.
  document.addEventListener("close", function (event) { if (shownLarge && event.target === shownLarge.sheet) { shownLarge.box.replaceChildren(); shownLarge = null; } }, true);
})();
`);

component({
  name: "Screens",
  slug: "screens",
  group: "layout",
  summary: "One page on the screens players bring (a phone and a laptop to start; a big phone, a phone on its side, an iPad, a Steam Deck and a 2560 desktop as asked), light and dark, side by side, each with what the measuring check finds. Point at or tap anything in a screen to see what it is and which rule placed it. It's where a page is reviewed, never made: the Screens page shows any page this way on a local preview.",
  styles: `
/* Screens: a desktop beside a phone (the phone at its own size), light over dark; one under the other where the desktop would get less
   than a phone's width. Each frame is carved into the pane and cut by the edge rule, scaled down to fit its cell, so the page inside keeps
   the screen's size; it shows once it has taken its light or dark. */
/* Its words at its foot keep the pane's margin, --pad-words under them. */
.screens { container-type: inline-size; padding-bottom: var(--pad-words); }
.screens-in { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, ${SCREEN_SIZES[0].widthPx}px), 1fr)); gap: var(--gap-block-block); align-items: start; }
.screen { margin: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--gap-words-control); }
.screen-view { position: relative; overflow: hidden; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
.screen-view > iframe, .screen-large > iframe { position: absolute; left: 0; top: 0; border: 0; transform-origin: 0 0; background: var(--page); visibility: hidden; }
.screen-view > iframe.is-shown, .screen-large > iframe.is-shown { visibility: visible; }
/* Larger: a screen's page in a picture's sheet, sized by the script to the screen's shape, scaled to fit. */
.screen-large { position: relative; max-width: 100%; overflow: hidden; background: var(--well); }
/* What's pointed at, outlined in the runner's orange over the frame. */
.screen-pointer { position: absolute; pointer-events: none; box-shadow: inset 0 0 0 2px var(--run); }
/* Larger sits at the caption's end. */
.screen-caption > :last-child { margin-inline-start: auto; }
.screen-caption { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-words-words); padding-inline: var(--pad-words); font: var(--type-facts); color: var(--ink-2); }
.screen-problems { margin: 0; padding: 0 var(--pad-words); list-style: none; display: flex; flex-direction: column; gap: var(--gap-words-words); font: var(--type-note); color: var(--ink-2); }
.screen-pointed { margin: 0; padding-inline: var(--pad-words); font: var(--type-note); color: var(--muted); }
`,
  render: screens,
  examples: [{ label: "The example page on a phone and a laptop", isWide: true, markup: screensPane({ path: "/design/example", title: "Example page" }) }],
});
