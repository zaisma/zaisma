import type { Env } from "./env.ts";
import { headScriptTags, html, pageData, raw, scriptTags, securityHeaders, styleTags, type Raw } from "./html.ts";
import { CITY_SCRIPT } from "./components/city.ts";
import { pageStyle } from "./page-styles.ts";
import { examplePage } from "./example-page.ts";
import { pageScript } from "./page-scripts.ts";
import { COMPONENT_GROUPS, type Component, type ComponentGroup } from "./components/component.ts";
import { COMPONENTS, COMPONENT_SCRIPT, COMPONENT_STYLES, HEADER_SCRIPT } from "./components/index.ts";
import { EDGE, backdrop, logo, pageSettingsAttributes, railMarkup } from "./components/foundations.ts";
import { cutButton, runButton, textLink } from "./components/actions.ts";
import { cutField, tabSwitch } from "./components/inputs.ts";
import { loadMore } from "./components/navigation.ts";
import { listRows } from "./components/data.ts";
import { cutPolygon, glassPane, tray } from "./components/foundations.ts";

/*
 * zaisma.com/design: every component of Zaisma's look in every state, in light and dark, a page per group. It's
 * rendered from the same code the pages use (components/), so changing a component changes it here and everywhere
 * it's used at once. Phone layouts show in a phone-sized window (or the browser's device mode); the Panes page holds
 * a scene the components can rest in. Public, linked from docs/DESIGN.md and the README, never from the footer or
 * the menus, and not in the sitemap.
 */

type GalleryTheme = "light" | "dark";

/** The theme a link asks for. Closed: anything but "dark" is light (it's a page, not the API). */
const themeOf = (url: URL): GalleryTheme => (url.searchParams.get("theme") === "dark" ? "dark" : "light");
const themeQuery = (theme: GalleryTheme) => (theme === "dark" ? "?theme=dark" : "");

/** Each group is a page of its own: the foundations at /design, the rest at /design/<group>. */
export const groupPath = (group: ComponentGroup) => (group === "foundations" ? "/design" : `/design/${group}`);
const groupOfPath = (pathname: string): ComponentGroup | undefined => COMPONENT_GROUPS.find(({ group }) => groupPath(group) === pathname)?.group;

function examples(each: Component): Raw {
  return html`<div class="examples">${each.examples.map((example) => html`<figure class="example${example.isWide ? " wide" : ""}"><div class="example-stage" data-on-no-pane${example.isStill ? raw(" inert") : ""}>${example.markup}</div><figcaption class="example-name">${example.label}</figcaption></figure>`)}</div>`;
}

function section(each: Component, theme: GalleryTheme): Raw {
  // Each section is a Tray: its name and summary on the pane, every example on the tray beneath it.
  return html`<div class="component-section" id="${each.slug}" data-rail-mark="${each.name}">${tray({
    head: html`<h2 class="component-name" id="${each.slug}-name">${textLink(each.name, `#${each.slug}`, { isQuiet: true })}</h2><p class="component-summary">${each.summary}</p>`,
    body: examples(each),
    label: each.name,
  })}</div>`;
}

/** The sun and the moon, from the sign-in draft's theme control. */

/** Light or dark: one cut button showing the theme you're in, a sun or a moon; pressing it switches to the other. */
const themeButton = (group: ComponentGroup, theme: GalleryTheme) =>
  cutButton(theme === "dark" ? "Dark. Switch to light" : "Light. Switch to dark", { href: `${groupPath(group)}${themeQuery(theme === "dark" ? "light" : "dark")}`, icon: "light-dark", isLabelHidden: true });

function head(title: string, group: ComponentGroup): Raw {
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="Every component of Zaisma's look, in every state, rendered from the site's own code.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="preload" href="/fonts/jost.woff2" as="font" type="font/woff2" crossorigin>
${styleTags(DESIGN_STYLE)}
${headScriptTags(COMPONENT_SCRIPT, HEADER_SCRIPT, GALLERY_SCRIPT, DESIGN_LOOPS_SCRIPT)}${group === "foundations" ? scriptTags(CITY_SCRIPT) : ""}`;
}

/** GET /design and /design/<group>: one group of the gallery, its components in every state. */
/** The Load more example's next pages (/design/examples/older-versions?page=2 and 3): its list of the same id, and on page 2 the Load more for page 3. */
function olderVersionsPage(env: Env, url: URL): Response {
  const pageNumber = url.searchParams.get("page") === "3" ? 3 : 2;
  const rows = [0, 1, 2].map((rowIndex) => {
    const versionNumber = 14 - (pageNumber - 1) * 3 - rowIndex;
    return { title: `Version ${versionNumber}`, detail: `Replaced · ${16 - versionNumber} weeks ago`, href: "#load-more" };
  });
  const page = html`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Older versions · Design · Zaisma</title></head><body>${listRows({ id: "example-load-more-list", rows })}${pageNumber < 3 ? loadMore({ href: "/design/examples/older-versions?page=3", label: "Show older versions", listId: "example-load-more-list" }) : ""}</body></html>`;
  return new Response(page.html, { headers: securityHeaders(env) });
}

export function designPage(env: Env, url: URL): Response | null {
  if (url.pathname === "/design/examples/older-versions") return olderVersionsPage(env, url);
  if (url.pathname === "/design/example") return examplePage(env);
  const group = groupOfPath(url.pathname.replace(/\/+$/, "") || "/");
  if (!group) return null;
  const theme = themeOf(url);
  const components = COMPONENTS();
  const groups = COMPONENT_GROUPS.filter(({ group: each }) => components.some((component) => component.group === each));
  const groupName = groups.find((each) => each.group === group)!.name;
  const groupTabs = groups.map(({ group: each, name }) => ({ label: name, href: `${groupPath(each)}${themeQuery(theme)}`, isCurrent: each === group }));
  const page = html`<!doctype html>
<html lang="en">
<head>
${head(`${groupName} · Design · Zaisma`, group)}
</head>
<body class="gallery">
<div id="stage" class="stage"${pageSettingsAttributes({ theme })}>${backdrop()}
<header class="gallery-bar glass" data-compacts data-rail-starts-below data-glass data-glass-corners="header">${EDGE}${logo("wordmark")}<span class="gallery-title">Design</span>
${themeButton(group, theme)}
<div class="gallery-groups">${tabSwitch({ label: "Groups", switchSize: "small", tabs: groupTabs, isFramed: true })}</div></header>
<div class="gallery-layout">
<nav class="gallery-index glass" aria-label="Groups" data-glass data-glass-corners="pane">${EDGE}${tabSwitch({ label: "Groups", switchSize: "big", isVertical: true, tabs: groupTabs.map((tab) => ({ ...tab, extra: raw(` data-gallery-page="${tab.href.split("?")[0]}"`) })) })}</nav>
<main class="gallery-main">
<h1 class="group-name">${groupName}</h1>
${components.filter((each) => each.group === group).map((each) => section(each, theme))}
</main>
</div>
${railMarkup("page")}
</div>
${pageData("design-pages", Object.fromEntries(components.map((each) => [each.slug, groupPath(each.group)])))}
</body>
</html>`;
  return new Response(page.html, { headers: securityHeaders(env) });
}

export const GALLERY_STYLES = `
/* The gallery: Zaisma's own page, a glass bar with the light or dark button, the groups, and each component's examples in labeled cells. */
/* Where things rest under the bar: its inset, its height and the gap between blocks, so the stuck index sits where it sat at the top. */
html { --gallery-bar-height: 68px; --under-gallery-bar: calc(var(--pad-pane) + var(--gallery-bar-height) + var(--gap-block-block)); scroll-padding-top: var(--under-gallery-bar); }
body.gallery { margin: 0; min-height: 100vh; font: var(--type-reading); }
.stage { min-height: 100vh; color: var(--ink); background: var(--page); }
/* Padding, not the bar's margin, keeps it off the top: a margin would collapse through the stage and show a strip of nothing above it. */
.stage { padding-top: var(--pad-pane); }
/* The bar floats like the header: inset from the top and both sides, with the header's own padding around what's in it. */
.gallery-bar { position: sticky; top: var(--pad-pane); z-index: 20; margin: 0 auto; width: calc(100% - 2 * var(--pad-pane)); max-width: calc(1480px - 2 * var(--pad-pane)); min-height: var(--gallery-bar-height); display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-control-stack) var(--gap-words-words); padding: var(--pad-inner-pane);
  --glass-tint: var(--glass-top); }
.gallery-bar > .logo { --logo-height: 24px; }
.gallery-title { font: var(--type-name); color: var(--ink-2); padding-left: var(--gap-words-words); border-left: var(--divider); }
.gallery-bar > .cut-btn { margin-left: auto; }
.gallery-layout { max-width: 1480px; margin: 0 auto; padding: var(--gap-block-block) var(--pad-pane) calc(2 * var(--gap-block-block)); display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: var(--gap-block-block); align-items: start; }
.gallery-index { position: sticky; top: var(--under-gallery-bar); align-self: start; padding: var(--pad-inner-pane); }
.gallery-groups { display: none; }
.gallery-main { min-width: 0; }
/* The group's name is already the current place in the index (or the tabs on a phone), so on the page it's only for screen readers. */
.group-name { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.component-section { margin: 0 0 calc(2 * var(--gap-block-block)); scroll-margin-top: var(--under-gallery-bar); }
.component-name { margin: 0; font: var(--type-section); }
.component-summary { margin: var(--gap-words-words) 0 0; color: var(--ink-2); max-width: 75ch; }
/* The examples end in their names, which are words at the tray's foot: they keep its margin there. */
.examples { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--gap-block-block); padding-bottom: var(--pad-words); }
.example { margin: 0; min-width: 0; display: flex; flex-direction: column; }
.example.wide { grid-column: 1 / -1; }
.example-stage > * { max-width: 100%; }
/* What the example is: a few quiet words just under it. */
.example { gap: var(--gap-words-control); }
.example-name { margin: 0; padding-inline: var(--pad-words); font: var(--type-facts); color: var(--muted); }
.example-stage { position: relative; display: flex; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: var(--gap-control-stack); padding: 0; }
.cover-sample { width: 260px; }
/* The loops' own pointer, moving onto the copy it plays. It sinks a little while it presses. */
[data-state-loop] { position: relative; display: inline-block; }
.loop-cursor { position: absolute; left: 0; top: 0; z-index: 8; pointer-events: none; transition: transform 0.65s cubic-bezier(.45,0,.25,1); filter: drop-shadow(0 2px 3px rgba(10,20,40,0.35)); }
.loop-cursor svg { display: block; transform-origin: 4px 3px; transition: transform 0.12s ease-out; }
.loop-cursor.is-down svg { transform: scale(0.84); }
.dropdown-frame { position: relative; width: 100%; height: 410px; transform: translateZ(0); }
.dropdown-frame > .cut-btn { position: absolute; right: 20px; top: 0; }
/* The rail's example: a pane held short, so what's in it scrolls on its rail. */
.rail-box { display: flex; height: 220px; }
.rail-side-box p { margin: 0; white-space: nowrap; }
.rail-example-part { margin: 0; font: var(--type-label); color: var(--ink); }
.rail-side-box { padding-top: var(--gap-block-block); }
/* A header example: a frame that holds the fixed header (its transform makes it the header's containing block) over a stand-in page scrolling under it. */
.header-frame { position: relative; isolation: isolate; width: 100%; height: 260px; overflow: hidden; transform: translateZ(0); box-shadow: var(--well-shade);
  clip-path: ${cutPolygon("pane")}; }
.header-frame.tall { height: 470px; }
.header-scroll { position: absolute; inset: 0; overflow-y: auto; scrollbar-width: none; }
.header-scroll::-webkit-scrollbar { display: none; }
.stand-in-page { padding: 100px 18px 160px; }
.stand-in-page h3 { margin: var(--gap-block-block) 0 var(--gap-words-control); font: var(--type-section); color: var(--ink); }
.stand-in-row { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: var(--gap-block-block); }
/* With a mouse, the page's rail gets a gutter of its own, clear of the cards. */
@media (hover: hover) and (pointer: fine) and (min-width: 761px) { .gallery-layout { padding-right: 34px; } }
/* Phones: the bar is one row (Zaisma, Design, light or dark), the groups a row of tabs under it that scrolls sideways, and every example a column of its own. */
@media (max-width: 760px) {
  html { scroll-padding-top: 130px; }
  .gallery-layout { grid-template-columns: minmax(0, 1fr); }
  .gallery-index { display: none; }
  /* The groups are a row of tabs inside the floating bar, which sticks as the page scrolls. At the very top the bar is roomy; once the page moves it tightens to the row and the tabs. */
  /* The switch's carved track stays put across the bar, its cut ends and light sharp; only the tabs scroll inside it, fading out
     before they reach its ends, and only on a side with more tabs past it, so the last tab is never under the fade at the end. */
  .gallery-groups { display: flex; flex: 1 0 100%; min-width: 0; }
  .gallery-groups > .switch-frame { flex: 1; }
  /* One even inset all round, and the same between the rows, so the tabs' frame and the light or dark button sit the same distance
     from every edge of the pane; compact keeps it even, only smaller. */
  .gallery-bar { min-height: 56px; transition: var(--glass-transition), padding 0.25s, gap 0.25s; }
  .gallery-bar.is-compact { padding: calc(var(--pad-inner-pane) * 2 / 3); }
  .gallery-bar > .logo { --logo-height: 22px; }
  .gallery-bar.is-compact > .logo { --logo-height: 18px; }
  .component-section { scroll-margin-top: 130px; }
  .examples { grid-template-columns: minmax(0, 1fr); }
  .cover-sample { width: 100%; }
  .dropdown-frame { height: 420px; }
  .dropdown-frame > .cut-btn { right: 8px; }
  /* The stand-in rows scroll sideways, as the home's do on a phone. */
  .stand-in-row { display: flex; overflow-x: auto; scrollbar-width: none; }
  .stand-in-row::-webkit-scrollbar { display: none; }
  .stand-in-row > .cover { flex: 0 0 64vw; }
  .stand-in-page { padding-top: 140px; }
  .header-frame { height: 320px; }
  .header-frame.tall { height: 560px; }
  /* A header example is narrower than a phone's screen: it keeps a closer inset in its frame, so its first row has a phone's room. */
  .header-frame .top { width: calc(100% - 2 * var(--gap-words-control)); }
}
`;

export const DESIGN_STYLE = pageStyle("design", () => COMPONENT_STYLES() + GALLERY_STYLES);

/**
 * The gallery's light or dark button swaps the theme in place, without a reload, and keeps the address current, so a view can be sent.
 * A link inside an example never jumps the page: the examples' links are there to be pointed at.
 */
export const GALLERY_SCRIPT = pageScript(
  "gallery",
  `(function () {
  var stage = document.getElementById("stage");
  var pages = JSON.parse(document.getElementById("design-pages").textContent);
  // A link to a component on another group's page (like /design#runner-button) goes on to that page.
  var asked = location.hash.slice(1);
  if (asked && !document.getElementById(asked) && pages[asked]) { location.replace(pages[asked] + location.search + location.hash); return; }
  function query(theme) { return theme === "dark" ? "?theme=dark" : ""; }
  // Light or dark switches in place, and every link to another group's page keeps it.
  var button = document.querySelector(".gallery-bar > .cut-btn");
  // The Page settings example's Light or Dark (a Switch) follows the theme wherever it's changed.
  function pickTheme(theme) {
    document.querySelectorAll("[data-setting-theme] .tab-switch").forEach(function (sw) {
      var tab = sw.querySelector('button[value="' + theme + '"]');
      if (tab && tab.getAttribute("aria-pressed") !== "true" && sw.pickTab) sw.pickTab(tab);
    });
  }
  function apply(theme) {
    window.zaismaSettings.set({ theme: theme }, stage);
    pickTheme(theme);
    if (button) { button.href = location.pathname + query(theme === "dark" ? "light" : "dark"); button.setAttribute("aria-label", theme === "dark" ? "Dark. Switch to light" : "Light. Switch to dark"); }
    document.querySelectorAll("[data-gallery-page], .gallery-groups a").forEach(function (link) {
      var url = new URL(link.href); link.href = url.pathname + query(theme) + url.hash;
    });
    history.replaceState(null, "", location.pathname + query(theme) + location.hash);
  }
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest(".gallery-bar > .cut-btn");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    event.preventDefault();
    apply(stage.dataset.themeChoice === "dark" ? "light" : "dark");
  });
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest('.example-stage a[href^="#"], .example-stage a[href^="/"]');
    if (link) event.preventDefault();
  });
  // A form in an example sends nothing; one in a sheet closes it, as if it had gone. Closing a sheet (Cancel, its close button) works as on a page.
  document.addEventListener("submit", function (event) {
    // One a page script already handled (a step flow moving on) is left to it.
    if (event.defaultPrevented || !event.target.closest(".example-stage") || event.target.getAttribute("method") === "dialog" || (event.submitter && event.submitter.getAttribute("formmethod") === "dialog")) return;
    event.preventDefault();
    var sheet = event.target.closest("dialog.sheet"); if (sheet && sheet.open) sheet.close();
    // A step flow's last step sends its form: here it starts over instead.
    if (event.target.goToStep) event.target.goToStep(0);
  });
  // The backdrop's 3D scene example: a cut-cornered slab turning slowly, drawn on each backdrop-frame in the theme's colors.
  document.querySelectorAll('.example-stage canvas[data-backdrop="scene"]').forEach(function (canvas) {
    var gl = canvas.getContext("webgl", { antialias: true });
    if (!gl) return;
    var W = 0.9, H = 0.55, K = 0.22, D = 0.12;
    var outline = [[-W + K, -H], [W - K, -H], [W, -H + K], [W, H - K], [W - K, H], [-W + K, H], [-W, H - K], [-W, -H + K]], data = [];
    function put(p, n) { data.push(p[0], p[1], p[2], n[0], n[1], n[2]); }
    outline.forEach(function (from, i) {
      var to = outline[(i + 1) % 8], dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy), side = [dy / length, -dx / length, 0];
      put([0, 0, D], [0, 0, 1]); put([from[0], from[1], D], [0, 0, 1]); put([to[0], to[1], D], [0, 0, 1]);
      put([0, 0, -D], [0, 0, -1]); put([to[0], to[1], -D], [0, 0, -1]); put([from[0], from[1], -D], [0, 0, -1]);
      put([from[0], from[1], D], side); put([from[0], from[1], -D], side); put([to[0], to[1], D], side);
      put([to[0], to[1], D], side); put([from[0], from[1], -D], side); put([to[0], to[1], -D], side);
    });
    function compile(kind, source) { var shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader); return shader; }
    var program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, "attribute vec3 position; attribute vec3 normal; uniform mat3 turn; uniform float aspect; varying vec3 facing;" +
      "void main() { vec3 p = turn * position; facing = turn * normal; gl_Position = vec4(p.x * 2.2 / aspect, p.y * 2.2, -p.z, 2.6 - p.z); }"));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, "precision mediump float; varying vec3 facing; uniform vec3 lit; uniform vec3 shade;" +
      "void main() { float l = clamp(dot(normalize(facing), normalize(vec3(-0.4, 0.7, 0.6))), 0.0, 1.0); gl_FragColor = vec4(mix(shade, lit, l), 1.0); }"));
    gl.linkProgram(program); gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    ["position", "normal"].forEach(function (name, i) { var at = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 3, gl.FLOAT, false, 24, i * 12); });
    var turn = gl.getUniformLocation(program, "turn"), aspect = gl.getUniformLocation(program, "aspect"), lit = gl.getUniformLocation(program, "lit"), shade = gl.getUniformLocation(program, "shade");
    gl.enable(gl.DEPTH_TEST);
    canvas.addEventListener("backdrop-frame", function (event) {
      var frame = event.detail, colors = frame.colors, y = frame.timeS * 0.3, x = 0.35 + 0.15 * Math.sin(frame.timeS * 0.2);
      var cy = Math.cos(y), sy = Math.sin(y), cx = Math.cos(x), sx = Math.sin(x);
      gl.viewport(0, 0, frame.widthPx, frame.heightPx);
      gl.clearColor(colors.base[0], colors.base[1], colors.base[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix3fv(turn, false, [cy, 0, -sy, sy * sx, cx, cy * sx, sy * cx, -sx, cy * cx]);
      gl.uniform1f(aspect, frame.widthPx / frame.heightPx);
      gl.uniform3fv(lit, colors.a.map(function (v) { return Math.min(1, v * 1.2 + 0.08); })); gl.uniform3fv(shade, colors.c.map(function (v) { return v * 0.6; }));
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
    });
  });
  // A component's section off screen isn't laid out or drawn (content-visibility), so a long group page costs no more to scroll
  // than its screenful: no glass, shapes or shaders of its own while out of view. Each keeps its own measured height while it's
  // skipped, so the page's length, its rail and its links never move. A change of width measures them all again.
  var sections = Array.prototype.slice.call(document.querySelectorAll(".component-section")), sectionsWidth = 0, measureTimer = 0;
  function holdSections() {
    if (!("contentVisibility" in document.documentElement.style)) return;
    var width = document.documentElement.clientWidth; if (width === sectionsWidth) return; sectionsWidth = width;
    sections.forEach(function (section) { section.style.contentVisibility = "visible"; });
    var heights = sections.map(function (section) { return section.getBoundingClientRect().height; });
    sections.forEach(function (section, i) { section.style.containIntrinsicHeight = "auto " + heights[i] + "px"; section.style.contentVisibility = "auto"; });
  }
  holdSections();
  if (document.fonts) document.fonts.ready.then(function () { sectionsWidth = 0; holdSections(); });
  window.addEventListener("resize", function () { clearTimeout(measureTimer); measureTimer = setTimeout(holdSections, 150); });
  // Spacing's examples: hatch the space each is about, over the stage, redrawn whenever its size changes.
  function markSpacing(holder) {
    var stage = holder.closest(".example-stage"); if (!stage) return;
    stage.querySelectorAll(".spacing-mark").forEach(function (mark) { mark.remove(); });
    var target = holder.getAttribute("data-spacing-of") ? holder.querySelector(holder.getAttribute("data-spacing-of")) : holder;
    if (!target) return;
    var s = stage.getBoundingClientRect(), boxes = [];
    if (holder.getAttribute("data-spacing-show") === "pad") {
      var t = target.getBoundingClientRect(), css = getComputedStyle(target);
      var top = parseFloat(css.paddingTop), right = parseFloat(css.paddingRight), bottom = parseFloat(css.paddingBottom), left = parseFloat(css.paddingLeft);
      boxes.push([t.left, t.top, t.width, top], [t.left, t.bottom - bottom, t.width, bottom], [t.left, t.top + top, left, t.height - top - bottom], [t.right - right, t.top + top, right, t.height - top - bottom]);
    } else {
      var kids = Array.prototype.filter.call(target.children, function (kid) { var css = getComputedStyle(kid); return kid.offsetWidth && css.position !== "absolute" && css.position !== "fixed" && kid.tagName !== "svg" && !kid.hidden; });
      for (var i = 1; i < kids.length; i++) {
        var a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
        var top = Math.max(a.top, b.top), height = Math.min(a.bottom, b.bottom) - top;
        // Side by side with their boxes overlapping: the space is between their slants, so the mark is slanted too.
        if (b.left < a.right - 1 && b.top < a.bottom - 1) {
          var slant = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--control-slant")) || 10, left = a.right - slant, width = b.left + slant - left;
          boxes.push([left, top, width, height, "polygon(" + slant + "px 0, " + width + "px 0, " + (width - slant) + "px 100%, 0 100%)"]);
        } else if (b.left >= a.right - 1) boxes.push([a.right, top, b.left - a.right, height]);
        else boxes.push([Math.max(a.left, b.left), a.bottom, Math.min(a.right, b.right) - Math.max(a.left, b.left), b.top - a.bottom]);
      }
    }
    boxes.forEach(function (box) {
      if (box[2] < 0.5 || box[3] < 0.5) return;
      var mark = document.createElement("span"); mark.className = "spacing-mark"; mark.setAttribute("aria-hidden", "true");
      if (box[4]) mark.style.clipPath = box[4];
      mark.style.left = box[0] - s.left + "px"; mark.style.top = box[1] - s.top + "px"; mark.style.width = box[2] + "px"; mark.style.height = box[3] + "px";
      stage.appendChild(mark);
    });
  }
  document.querySelectorAll("[data-spacing-show]").forEach(function (holder) {
    markSpacing(holder);
    if (window.ResizeObserver) new ResizeObserver(function () { markSpacing(holder); }).observe(holder.closest(".example-stage") || holder);
  });
  if (document.fonts) document.fonts.ready.then(function () { document.querySelectorAll("[data-spacing-show]").forEach(markSpacing); });
  // Glass at any size: drag the window about, pull its corner to resize it, or use the arrow keys (Shift resizes).
  // Page settings: the stage carries the gallery's, so a pick here changes every component in it at once.
  document.addEventListener("click", function (event) {
    var themePick = event.target.closest && event.target.closest("[data-setting-theme] button");
    if (themePick) { apply(themePick.value); return; }
    var huePick = event.target.closest && event.target.closest("[data-setting-hue] .color-pick");
    if (huePick) window.zaismaSettings.set({ glass: { hueColor: huePick.getAttribute("data-color-value") || null } }, stage);
  });
  pickTheme(stage.dataset.themeChoice === "dark" ? "dark" : "light");
  document.querySelectorAll("[data-glass-play]").forEach(function (play) {
    var win = play.querySelector(".glass-window"), grip = win.querySelector(".glass-grip"), readout = win.querySelector(".glass-size");
    var MIN_W = 64, MIN_H = 40;
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function place(box) {
      var w = clamp(box.w, MIN_W, play.clientWidth), h = clamp(box.h, MIN_H, play.clientHeight);
      win.style.width = w + "px"; win.style.height = h + "px";
      win.style.left = clamp(box.x, 0, play.clientWidth - w) + "px"; win.style.top = clamp(box.y, 0, play.clientHeight - h) + "px";
      readout.textContent = Math.round(w) + " \u00d7 " + Math.round(h);
    }
    function now() { return { x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight }; }
    win.addEventListener("pointerdown", function (event) {
      if (event.button) return;
      var start = now(), fromX = event.clientX, fromY = event.clientY, isResizing = grip.contains(event.target);
      win.setPointerCapture(event.pointerId); win.classList.add("is-moving");
      function follow(move) {
        var dx = move.clientX - fromX, dy = move.clientY - fromY;
        place(isResizing ? { x: start.x, y: start.y, w: start.w + dx, h: start.h + dy } : { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h });
      }
      function stop() { win.removeEventListener("pointermove", follow); win.removeEventListener("pointerup", stop); win.removeEventListener("pointercancel", stop); win.classList.remove("is-moving"); }
      win.addEventListener("pointermove", follow); win.addEventListener("pointerup", stop); win.addEventListener("pointercancel", stop);
    });
    var KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    win.addEventListener("keydown", function (event) {
      var step = KEYS[event.key]; if (!step) return;
      event.preventDefault();
      var box = now(), by = event.altKey ? 1 : 12;
      if (event.shiftKey) { box.w += step[0] * by; box.h += step[1] * by; } else { box.x += step[0] * by; box.y += step[1] * by; }
      place(box);
    });
    place(now());
  });
  // The glass button's tint palette: the button above takes the tint you pick.
  document.addEventListener("click", function (event) {
    var swatch = event.target.closest && event.target.closest("[data-tint-try] .color-pick"); if (!swatch) return;
    swatch.closest("[data-tint-try]").querySelector(".glass-btn").setAttribute("data-tint", swatch.getAttribute("data-color-value"));
  });
})();
`,
);

/**
 * The gallery's loops: a still copy of a button, a switch or a cover with a pointer of its own that moves onto it, presses,
 * lets go and moves off, over and over. The copy shows each moment through the same state classes the still examples
 * use; a switch is played through its own script, by the events a pointer would send. Reduced motion holds them still.
 */
export const DESIGN_LOOPS_SCRIPT = pageScript(
  "design-loops",
  `(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var TARGETS = { runner: ".run-wrap", cut: ".cut-btn", glass: ".glass-btn", guest: ".guest-btn", text: ".text-btn", check: ".check", choice: ".choice-card", toggle: ".toggle", row: ".list-row", cover: ".cover", switch: ".tab-switch" };
  var MOVE_MS = 650, PRESS_MS = 180;
  function wait(ms) { return new Promise(function (done) { setTimeout(done, ms); }); }
  function send(el, type) { el.dispatchEvent(new MouseEvent(type, { bubbles: type !== "pointerenter" && type !== "pointerleave" })); }
  document.querySelectorAll("[data-state-loop]").forEach(function (box) {
    var kind = box.getAttribute("data-state-loop"), el = box.querySelector(TARGETS[kind]); if (!el) return;
    var cursor = document.createElement("span"); cursor.className = "loop-cursor"; cursor.setAttribute("aria-hidden", "true");
    cursor.innerHTML = '<svg viewBox="0 0 20 24" width="20" height="24"><path d="M3 2v17l4.6-4.4 3.1 6.9 2.6-1.1-3.1-6.8H16z" fill="#fff" stroke="#14171C" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    box.appendChild(cursor);
    // A loop off screen holds still where it is: nobody sees it, and its measuring each frame would make the page lay out its
    // skipped sections again. It carries on when it's back in view.
    var isShown = false, resumers = [], isWatching = false;
    function whenShown() { return isShown ? Promise.resolve() : new Promise(function (done) { resumers.push(done); }); }
    new IntersectionObserver(function (entries) {
      isShown = entries[entries.length - 1].isIntersecting;
      if (!isShown) return;
      resumers.splice(0).forEach(function (done) { done(); });
      if (!isWatching) watch();
    }).observe(box);
    function point(target, dx, dy) {
      var b = box.getBoundingClientRect(), r = target.getBoundingClientRect();
      return [r.left - b.left + r.width * dx, r.top - b.top + r.height * dy];
    }
    function moveTo(at, isQuick) { cursor.style.transitionDuration = isQuick ? "0s" : MOVE_MS + "ms"; cursor.style.transform = "translate(" + at[0].toFixed(1) + "px," + at[1].toFixed(1) + "px)"; return wait(isQuick ? 30 : MOVE_MS); }
    function press(isDown) { cursor.classList.toggle("is-down", isDown); isPressed = isDown; show(); }
    // What the pointer's tip is over, each frame, as it moves: pointing starts the moment it crosses onto the copy and ends the moment it leaves.
    var isPressed = false, over = null, run = el.querySelector(".run");
    function tip() { var r = cursor.getBoundingClientRect(); return [r.left + 3, r.top + 2]; }
    function inside(target, at) { var r = target.getBoundingClientRect(); return at[0] >= r.left && at[0] <= r.right && at[1] >= r.top && at[1] <= r.bottom; }
    function show() {
      if (kind === "switch") return;
      var state = over ? (isPressed && kind !== "cover" ? "is-pressed" : "is-pointed") : "";
      ["is-pointed", "is-pressed"].forEach(function (each) { el.classList.toggle(each, each === state); });
    }
    function watch() {
      isWatching = isShown; if (!isShown) return;
      requestAnimationFrame(watch);
      var at = tip(), now = null;
      // The glass's light follows the pointer, as it does a real one.
      if (kind === "glass") { var r = el.getBoundingClientRect(); el.style.setProperty("--mx", (at[0] - r.left).toFixed(0) + "px"); el.style.setProperty("--my", (at[1] - r.top).toFixed(0) + "px"); }
      if (kind === "switch") { el.querySelectorAll("button").forEach(function (tab) { if (inside(tab, at)) now = tab; }); }
      else if (inside(el, at)) now = el;
      if (now === over) return;
      if (kind === "switch") { if (now) send(now, "pointerenter"); else send(el, "pointerleave"); }
      else if (now && run) { run.classList.remove("glint"); void run.offsetWidth; run.classList.add("glint"); }
      over = now; show();
    }
    // Off to the lower right, but never past the window's edge (a full-width button on a phone has no room beside it).
    var away = function () { var at = point(el, 1.15, 1.6), left = box.getBoundingClientRect().left; at[0] = Math.min(at[0], document.documentElement.clientWidth - left - 28); return at; };
    async function buttonLoop() {
      await whenShown();
      await moveTo(away(), true);
      for (;;) {
        await whenShown();
        await wait(900);
        await moveTo(point(el, 0.62, 0.58));
        await wait(800);
        press(true); await wait(PRESS_MS + 60);
        press(false); await wait(700);
        await moveTo(away());
      }
    }
    async function switchLoop() {
      var tabs = el.querySelectorAll("button"), at = 0;
      await whenShown();
      await moveTo(point(el, 1.08, 1.5), true);
      for (;;) {
        await whenShown();
        var other = tabs[(at + 1) % tabs.length];
        await wait(700);
        await moveTo(point(other, 0.55, 0.6)); await wait(700);
        press(true); await wait(PRESS_MS); send(other, "click"); press(false); await wait(800);
        await moveTo(point(el, at % 2 ? 1.08 : -0.12, 1.5));
        at++;
      }
    }
    (kind === "switch" ? switchLoop : buttonLoop)();
  });
})();
`,
);
