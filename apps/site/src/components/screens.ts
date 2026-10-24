import { html, type Raw } from "../markup.ts";
import { pageScript, pageScriptPath } from "../page-scripts.ts";
import { component } from "./component.ts";
import { glassPane, tag } from "./foundations.ts";
import { cutButton, runButton, textLink } from "./actions.ts";
import { cutField } from "./inputs.ts";
import { grid, paneParts, row, stack } from "./layout.ts";
import { MEASURE_LAYOUT_SOURCE } from "./layout-measure.ts";
import { CHECKED_PAGES, SCREEN_SIZES, SCREEN_THEMES, type CheckedPage, type StepToTake, UNIQUE_WORD } from "./checked-pages.ts";

/** Zaisma's branches, in the order Screens shows them. */
const AREAS: CheckedPage["area"][] = ["Playing", "Signing in", "Developers", "Gallery"];

/*
 * Screens: one page on Julius's phone and on a desktop, light and dark, side by side, each measured by the layout check. It's where a
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
}

/** The measuring check, as a script each screen puts in its page to run once it has drawn (scripts/layout-check.mjs runs the same). */
export const LAYOUT_MEASURE_SCRIPT = pageScript("layout-measure", `window.zaismaMeasureLayout = ${MEASURE_LAYOUT_SOURCE};`);

/** One page on the four screens: a desktop beside a phone, light over dark, each with what the measuring check finds under it. */
export function screens(options: ScreensOptions): Raw {
  const shown = SCREEN_THEMES.flatMap((theme) => [SCREEN_SIZES[1], SCREEN_SIZES[0]].map((screenSize) => ({ theme, screenSize })));
  return html`<div class="screens" data-screens${options.stepsToTake ? html` data-steps-to-take="${JSON.stringify(options.stepsToTake)}"` : ""} data-measure-script="${pageScriptPath(LAYOUT_MEASURE_SCRIPT)}" data-inspect-script="${pageScriptPath(LAYOUT_INSPECT_SCRIPT)}"><div class="screens-in">${shown.map(({ theme, screenSize }) => {
    const name = `${screenSize.name}, ${theme}`;
    return html`<figure class="screen" data-screen data-width-px="${String(screenSize.widthPx)}" data-height-px="${String(screenSize.heightPx)}" data-screen-theme="${theme}">
<div class="screen-view" data-cut-line="0"><iframe src="${options.path}" title="${options.title}: ${name}" width="${String(screenSize.widthPx)}" height="${String(screenSize.heightPx)}" loading="lazy"></iframe><div class="screen-pointer" hidden></div></div>
<figcaption class="screen-caption"><span>${name} · ${String(screenSize.widthPx)} × ${String(screenSize.heightPx)}</span><span data-screen-verdict>${tag("Measuring", "count")}</span></figcaption>
<ul class="screen-problems" data-screen-problems hidden></ul>
<p class="screen-pointed" data-screen-pointed>Point at or tap anything to see what it is and what placed it.</p>
</figure>`;
  })}</div></div>`;
}

/** The Screens page's first pane: what it is, the pages the check measures in Zaisma's branches, and any page to show. */
export function screensPicker(path: string): Raw {
  const ownPages = CHECKED_PAGES.filter((page) => !page.isOnSignInSite && !page.isOffScreens && !page.path.startsWith(SCREENS_PATH));
  return glassPane({
    paneWidth: "full",
    label: "Pick a page",
    body: stack({
      items: [
        { kind: "words", markup: html`<p>A page on a phone at 320 × 667 and a desktop at 1440 × 900, light and dark, each measured by the layout check. Point at or tap anything in a screen to see what it is and what placed it.</p>` },
        // The pages the check measures, in Zaisma's branches: each branch's name over its pages.
        {
          kind: "block",
          markup: grid({
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
          markup: html`<form method="get" action="${SCREENS_PATH}">${row({ widths: "lead-fills", items: [{ kind: "control", markup: cutField({ id: "screens-page", name: "page", label: "Page", type: "text", icon: "globe", text: path, placeholder: "/signin" }) }, { kind: "control", markup: runButton("Show", { type: "submit" }) }] })}</form>`,
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
    body: paneParts({ head: { words: html`<h2>${options.title}</h2><p>${options.path}</p>`, end: cutButton("Open it", { href: options.path }) }, body: screens(options) }),
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
  document.querySelectorAll("[data-screen]").forEach(function (figure) {
    var view = figure.querySelector(".screen-view"), frame = view.querySelector("iframe"), pointer = view.querySelector(".screen-pointer");
    var verdict = figure.querySelector("[data-screen-verdict]"), problems = figure.querySelector("[data-screen-problems]"), pointed = figure.querySelector("[data-screen-pointed]");
    var widthPx = Number(figure.dataset.widthPx), heightPx = Number(figure.dataset.heightPx), theme = figure.dataset.screenTheme, scale = 1;
    var scripts = figure.closest("[data-screens]").dataset, idle = pointed.textContent;
    // A state only forms and links reach: each step is taken once its page is there, and the last one's answer is measured.
    var steps = scripts.stepsToTake ? JSON.parse(scripts.stepsToTake) : [], stepIndex = 0;
    function takeStep(doc) {
      var step = steps[stepIndex++];
      if (step.path) { frame.contentWindow.location.assign(step.path); return; }
      var found = Array.prototype.find.call(doc.querySelectorAll("form"), function (each) { return each.getAttribute("action") === step.formAction; });
      if (!found) { verdict.textContent = "Couldn't send the form for " + step.formAction; return; }
      var word = Math.random().toString(36).slice(2, 10);
      Object.keys(step.fieldValues).forEach(function (name) {
        var field = found.elements.namedItem(name);
        if (!field) { field = doc.createElement("input"); field.type = "hidden"; field.name = name; found.append(field); }
        field.value = step.fieldValues[name].split(${JSON.stringify(UNIQUE_WORD)}).join(word);
      });
      // As a browser without the page's scripts would send it (checked-pages.ts, FormToSend): its answer loads whole, and measures.
      HTMLFormElement.prototype.submit.call(found);
    }
    function fit() { scale = Math.min(1, view.clientWidth / widthPx); frame.style.transform = "scale(" + scale + ")"; view.style.height = Math.round(heightPx * scale) + "px"; }
    fit(); window.zaismaWatch.size(view, fit);
    function found(failures) {
      verdict.textContent = "";
      var mark = document.createElement("span"); mark.className = "tag " + (failures.length ? "warning" : "new"); mark.textContent = failures.length ? failures.length + " out of line" : "Nothing out of line"; verdict.append(mark);
      problems.replaceChildren.apply(problems, failures.map(function (failure) { var item = document.createElement("li"); item.textContent = failure.check + ": " + failure.element + ", " + failure.said; return item; }));
      problems.hidden = !failures.length;
    }
    function hide() { pointer.hidden = true; pointed.textContent = idle; }
    frame.addEventListener("load", ready);
    function ready() {
      var doc = null; try { doc = frame.contentDocument; } catch (error) {}
      if (!doc || !doc.documentElement) { verdict.textContent = "Not a page on this site"; return; }
      if (stepIndex < steps.length) { takeStep(doc); return; }
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
          pointed.textContent = [(at.component || "Words") + (at.label ? ' "' + at.label + '"' : ""), at.layoutRule].filter(Boolean).join(" · ");
        }, { passive: true }); });
        doc.documentElement.addEventListener("mouseleave", hide);
      });
    }
  });
})();
`);

component({
  name: "Screens",
  slug: "screens",
  group: "layout",
  summary: "One page on a phone at 320 × 667 and a desktop at 1440 × 900, light and dark, side by side, each with what the measuring check finds. Point at or tap anything in a screen to see what it is and which rule placed it. It's where a page is reviewed, never made: the Screens page shows any page this way on a local preview.",
  styles: `
/* Screens: a desktop beside a phone (the phone at its own size), light over dark; one under the other where the desktop would get less
   than a phone's width. Each frame is carved into the pane and cut by the edge rule, scaled down to fit its cell, so the page inside keeps
   the screen's size; it shows once it has taken its light or dark. */
/* Its words at its foot keep the pane's margin, --pad-words under them. */
.screens { container-type: inline-size; padding-bottom: var(--pad-words); }
.screens-in { display: grid; grid-template-columns: minmax(0, 1fr) ${SCREEN_SIZES[0].widthPx}px; gap: var(--gap-block-block); align-items: start; }
@container (max-width: ${2 * SCREEN_SIZES[0].widthPx + 24}px) { .screens-in { grid-template-columns: minmax(0, 1fr); } }
.screen { margin: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--gap-words-control); }
.screen-view { position: relative; overflow: hidden; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
.screen-view > iframe { position: absolute; left: 0; top: 0; border: 0; transform-origin: 0 0; background: var(--page); visibility: hidden; }
.screen-view > iframe.is-shown { visibility: visible; }
/* What's pointed at, outlined in the runner's orange over the frame. */
.screen-pointer { position: absolute; pointer-events: none; box-shadow: inset 0 0 0 2px var(--run); }
.screen-caption { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-words-words); padding-inline: var(--pad-words); font: var(--type-facts); color: var(--ink-2); }
.screen-problems { margin: 0; padding: 0 var(--pad-words); list-style: none; display: flex; flex-direction: column; gap: var(--gap-words-words); font: var(--type-note); color: var(--ink-2); }
.screen-pointed { margin: 0; padding-inline: var(--pad-words); font: var(--type-note); color: var(--muted); }
`,
  render: screens,
  examples: [{ label: "The example page on the four screens", isWide: true, markup: screensPane({ path: "/design/example", title: "Example page" }) }],
});
