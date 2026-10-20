import type { Env } from "./env.ts";
import { html, pageData, raw, scriptTags, securityHeaders, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { COMPONENT_GROUPS, type Component, type ComponentGroup } from "./components/component.ts";
import { COMPONENTS, COMPONENT_SCRIPT, COMPONENT_STYLES, HEADER_SCRIPT } from "./components/index.ts";
import { CUT_LINE, EDGE, WORDMARK, backdrop, railMarkup } from "./components/foundations.ts";
import { cutButton, runButton } from "./components/actions.ts";
import { cutField, tabSwitch } from "./components/inputs.ts";
import { glassPane } from "./components/panes.ts";
import { sidebar } from "./components/navigation.ts";

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
  return html`<div class="examples">${each.examples.map((example) => html`<figure class="example${example.isWide ? " wide" : ""}"><div class="example-stage"${example.isStill ? raw(" inert") : ""}>${example.markup}</div><figcaption class="example-name">${example.label}</figcaption></figure>`)}</div>`;
}

function section(each: Component, theme: GalleryTheme): Raw {
  return html`<section class="component-section" id="${each.slug}" aria-labelledby="${each.slug}-name" data-rail-mark="${each.name}">
<div class="component-head glass" data-glass data-glass-corners="14 6 14 6"><h2 id="${each.slug}-name"><a href="#${each.slug}">${each.name}</a></h2><p>${each.summary}</p></div>
${examples(each)}
</section>`;
}

/** The sun and the moon, from the sign-in draft's theme control. */
const SUN = raw('<svg class="theme-sun" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
const MOON = raw('<svg class="theme-moon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M15.5 12.6A6.6 6.6 0 0 1 7.4 4.5a6.6 6.6 0 1 0 8.1 8.1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>');

/** Light or dark: one cut button showing the theme you're in, a sun or a moon; pressing it switches to the other. */
const themeButton = (group: ComponentGroup, theme: GalleryTheme) =>
  html`<a class="shell cut-btn theme-button" href="${groupPath(group)}${themeQuery(theme === "dark" ? "light" : "dark")}" aria-label="${theme === "dark" ? "Dark. Switch to light" : "Light. Switch to dark"}"><span class="face cut-raised" data-cut-line="10" data-cut-ends="mirror">${CUT_LINE}${SUN}${MOON}</span></a>`;

function head(title: string): Raw {
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="Every component of Zaisma's look, in every state, rendered from the site's own code.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="preload" href="/fonts/jost.woff2" as="font" type="font/woff2" crossorigin>
<style>${raw(COMPONENT_STYLES() + GALLERY_STYLES)}</style>`;
}

/** GET /design and /design/<group>: one group of the gallery, its components in every state. */
export function designPage(env: Env, url: URL): Response | null {
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
${head(`${groupName} · Design · Zaisma`)}
</head>
<body class="gallery">
<div id="stage" class="stage" data-theme-choice="${theme}">${backdrop()}
<header class="gallery-bar glass" data-glass data-glass-corners="16 6 16 6">${EDGE}<a class="logo" href="/" aria-label="Zaisma home">${WORDMARK}</a><span class="gallery-title">Design</span>
${themeButton(group, theme)}
<div class="gallery-groups">${tabSwitch({ label: "Groups", switchSize: "small", tabs: groupTabs })}</div></header>
<div class="gallery-layout">
<div class="gallery-index">${sidebar({ label: "Groups", groups: [{ items: groupTabs.map((tab) => ({ label: tab.label, href: tab.href, isCurrent: tab.isCurrent, extra: raw(` data-gallery-page="${tab.href.split("?")[0]}"`) })) }] })}</div>
<main class="gallery-main">
<h1 class="group-name">${groupName}</h1>
${components.filter((each) => each.group === group).map((each) => section(each, theme))}
</main>
</div>
${railMarkup("page")}
</div>
${pageData("design-pages", Object.fromEntries(components.map((each) => [each.slug, groupPath(each.group)])))}
${scriptTags(COMPONENT_SCRIPT, HEADER_SCRIPT, GALLERY_SCRIPT, DESIGN_LOOPS_SCRIPT)}
</body>
</html>`;
  return new Response(page.html, { headers: securityHeaders(env) });
}

export const GALLERY_STYLES = `
/* The gallery: Zaisma's own page, a glass bar with the light or dark button, the groups, and each component's examples in labelled cells. */
html { scroll-padding-top: 96px; }
body.gallery { margin: 0; min-height: 100vh; font: 15px/1.5 var(--body); }
.stage { min-height: 100vh; color: var(--ink); background: var(--page); }
/* Padding, not the bar's margin, keeps it off the top: a margin would collapse through the stage and show a strip of nothing above it. */
.stage { padding-top: 12px; }
/* The bar floats like the header: inset from the top and both sides, with the header's own padding around what's in it. */
.gallery-bar { position: sticky; top: 12px; z-index: 20; margin: 0 auto; width: calc(100% - 24px); max-width: 1480px; min-height: 68px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 22px; padding: 14px 16px 14px 26px;
  --glass-tint: var(--glass-top); }
.gallery-bar .logo svg { height: 24px; }
.gallery-title { font: 600 18px var(--display); color: var(--ink-2); padding-left: 14px; border-left: 1px solid var(--line); }
.theme-button { margin-left: auto; }
.theme-button > .face { width: 52px; padding: 0; }
.theme-button .theme-sun, .theme-button .theme-moon { position: relative; z-index: 2; flex: none; }
.stage[data-theme-choice="dark"] .theme-sun, .stage:not([data-theme-choice="dark"]) .theme-moon { display: none; }
.gallery-layout { max-width: 1480px; margin: 0 auto; padding: 18px 12px 80px; display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 18px; align-items: start; }
.gallery-index { position: sticky; top: 100px; display: flex; max-height: calc(100vh - 114px); }
.gallery-groups { display: none; }
.gallery-main { min-width: 0; }
.group-name { margin: 0 0 14px; font: 600 30px/1.1 var(--display); color: var(--ink); display: inline-block; padding: 8px 22px; background: var(--glass-tint); clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%); }
.component-section { margin: 0 0 34px; scroll-margin-top: 96px; }
.component-head { padding: 16px 22px; margin-bottom: 12px; }
.component-head h2 { margin: 0; font: 600 24px var(--display); }
.component-head h2 a { color: inherit; text-decoration: none; }
.component-head p { margin: 4px 0 0; color: var(--ink-2); max-width: 75ch; }
.component-head a:not(h2 a) { color: var(--ink); text-decoration-color: var(--run); text-underline-offset: 3px; }
.examples { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.example { margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.example.wide { grid-column: 1 / -1; }
.example-stage > * { max-width: 100%; }
/* What the example is: a few quiet words just under it. */
.example { gap: 2px; }
.example-name { margin: 0 18px; font: 500 12px/1.3 var(--display); color: var(--muted); }
.example-stage { position: relative; display: flex; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: 12px; padding: 16px 18px 6px; }
.example-pane { width: min(380px, 100%); padding: 22px 24px; display: flex; flex-direction: column; gap: 14px; }
.example-wide { width: 100%; padding: 20px 24px; }
.cover-sample { width: 260px; }
/* The loops' own pointer, moving onto the copy it plays. It sinks a little while it presses. */
[data-state-loop] { position: relative; display: inline-block; }
.loop-cursor { position: absolute; left: 0; top: 0; z-index: 8; pointer-events: none; transition: transform 0.65s cubic-bezier(.45,0,.25,1); filter: drop-shadow(0 2px 3px rgba(10,20,40,0.35)); }
.loop-cursor svg { display: block; transform-origin: 4px 3px; transition: transform 0.12s ease-out; }
.loop-cursor.is-down svg { transform: scale(0.84); }
.menu-frame { position: relative; width: 100%; height: 340px; transform: translateZ(0); }
.menu-frame > .cut-btn { position: absolute; right: 20px; top: 0; }
.rail-box { position: relative; width: min(420px, 100%); height: 220px; }
.rail-box-in { height: 100%; overflow-y: auto; padding: 18px 28px 18px 22px; }
.rail-box-in p { margin: 0; color: var(--ink-2); }
/* A header example: a frame that holds the fixed header (its transform makes it the header's containing block) over a stand-in page scrolling under it. */
.header-frame { position: relative; width: 100%; height: 260px; overflow: hidden; transform: translateZ(0); }
.header-frame.tall { height: 470px; }
.header-frame.logo-frame { height: 110px; }
.header-scroll { position: absolute; inset: 0; overflow-y: auto; scrollbar-width: none; }
.header-scroll::-webkit-scrollbar { display: none; }
.stand-in-page { padding: 100px 18px 160px; }
.stand-in-page h3 { margin: 18px 0 8px; font: 600 20px var(--display); color: var(--ink); }
.stand-in-row { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 14px; }
/* With a mouse, the page's rail gets a gutter of its own, clear of the cards. */
@media (hover: hover) and (pointer: fine) and (min-width: 761px) { .gallery-layout { padding-right: 34px; } }
/* Phones: the bar is one row (Zaisma, Design, light or dark), the groups a row of tabs under it that scrolls sideways, and every example a column of its own. */
@media (max-width: 760px) {
  html { scroll-padding-top: 130px; }
  .stage { padding-top: 10px; }
  .gallery-layout { grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 12px 10px 60px; }
  .gallery-index { display: none; }
  /* The groups are a row of tabs inside the floating bar, which sticks as the page scrolls. At the very top the bar is roomy; once the page moves it tightens to the row and the tabs. */
  .gallery-groups { display: block; flex: 1 0 100%; min-width: 0; overflow-x: auto; scrollbar-width: none; --fade-l: 0px; --fade-r: 0px;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent 100%);
    mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent 100%); }
  .gallery-groups::-webkit-scrollbar { display: none; }
  .gallery-groups .tab-switch { width: max-content; }
  /* Only a side with more tabs past it fades, so the last tab is never under the fade at the end. */
  .gallery-groups.more-left { --fade-l: 28px; }
  .gallery-groups.more-right { --fade-r: 28px; }
  .gallery-bar { position: sticky; top: 10px; width: calc(100% - 20px); min-height: 56px; flex-wrap: wrap; align-items: center; gap: 14px 12px; padding: 16px 12px 16px 16px; transition: padding 0.25s, gap 0.25s; }
  .gallery-bar.is-scrolled { gap: 8px 12px; padding: 8px 10px 10px 16px; }
  .gallery-bar .logo svg { height: 22px; transition: height 0.25s; }
  .gallery-bar.is-scrolled .logo svg { height: 18px; }
  .gallery-title { font-size: 16px; padding-left: 10px; }
  .theme-button { flex: none; }
  .theme-button > .face { height: 40px; width: 48px; }
  .group-name { font-size: 24px; padding: 6px 16px; }
  .component-section { scroll-margin-top: 130px; margin-bottom: 26px; }
  .component-head { padding: 14px 16px; }
  .component-head h2 { font-size: 20px; }
  .examples { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .example-stage { padding: 12px 6px 4px; }
  .example-name { margin: 0 6px; }
  .cover-sample { width: 100%; }
  .menu-frame { height: 360px; }
  .menu-frame > .cut-btn { right: 8px; }
  /* The stand-in rows scroll sideways, as the home's do on a phone. */
  .stand-in-row { display: flex; overflow-x: auto; scrollbar-width: none; }
  .stand-in-row::-webkit-scrollbar { display: none; }
  .stand-in-row > .cover { flex: 0 0 64vw; }
  .stand-in-page { padding-top: 140px; }
  .header-frame { height: 320px; }
  .header-frame.tall { height: 560px; }
}
`;

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
  var button = document.querySelector(".theme-button");
  function apply(theme) {
    stage.dataset.themeChoice = theme;
    if (button) { button.href = location.pathname + query(theme === "dark" ? "light" : "dark"); button.setAttribute("aria-label", theme === "dark" ? "Dark. Switch to light" : "Light. Switch to dark"); }
    document.querySelectorAll("[data-gallery-page], .gallery-groups a").forEach(function (link) {
      var url = new URL(link.href); link.href = url.pathname + query(theme) + url.hash;
    });
    history.replaceState(null, "", location.pathname + query(theme) + location.hash);
  }
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest(".theme-button");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    event.preventDefault();
    apply(stage.dataset.themeChoice === "dark" ? "light" : "dark");
  });
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest('.example-stage a[href^="#"], .example-stage a[href^="/"]');
    if (link) event.preventDefault();
  });
  // On a phone, the row of groups starts scrolled to the one you're on.
  var groups = document.querySelector(".gallery-groups"), here = groups && groups.querySelector('[aria-current="page"]');
  if (here) groups.scrollLeft = Math.max(0, here.offsetLeft - (groups.clientWidth - here.offsetWidth) / 2);
  // The floating bar tightens once the page moves, and the row fades only on a side that has more tabs past it.
  var bar = document.querySelector(".gallery-bar");
  function syncBar() { bar.classList.toggle("is-scrolled", window.scrollY > 24); }
  function syncFade() {
    if (!groups) return;
    groups.classList.toggle("more-left", groups.scrollLeft > 2);
    groups.classList.toggle("more-right", groups.scrollLeft + groups.clientWidth < groups.scrollWidth - 2);
  }
  window.addEventListener("scroll", syncBar, { passive: true }); window.addEventListener("resize", syncFade);
  if (groups) groups.addEventListener("scroll", syncFade, { passive: true });
  syncBar(); syncFade();
  document.addEventListener("submit", function (event) { if (event.target.closest(".example-stage")) event.preventDefault(); });
  // The backdrop's 3D scene example: a cut-cornered slab turning slowly, drawn on each backdrop-frame in the theme's colours.
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
      var frame = event.detail, colours = frame.colours, y = frame.timeS * 0.3, x = 0.35 + 0.15 * Math.sin(frame.timeS * 0.2);
      var cy = Math.cos(y), sy = Math.sin(y), cx = Math.cos(x), sx = Math.sin(x);
      gl.viewport(0, 0, frame.widthPx, frame.heightPx);
      gl.clearColor(colours.base[0], colours.base[1], colours.base[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix3fv(turn, false, [cy, 0, -sy, sy * sx, cx, cy * sx, sy * cx, -sx, cy * cx]);
      gl.uniform1f(aspect, frame.widthPx / frame.heightPx);
      gl.uniform3fv(lit, colours.a.map(function (v) { return Math.min(1, v * 1.2 + 0.08); })); gl.uniform3fv(shade, colours.c.map(function (v) { return v * 0.6; }));
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
    });
  });
  // Glass at any size: drag the window about, pull its corner to resize it, or use the arrow keys (Shift resizes).
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
    var swatch = event.target.closest && event.target.closest("[data-tint-choice]"); if (!swatch) return;
    var box = swatch.closest("[data-tint-try]");
    box.querySelector(".glass-btn").setAttribute("data-tint", swatch.getAttribute("data-tint-choice"));
    box.querySelectorAll("[data-tint-choice]").forEach(function (each) { each.setAttribute("aria-pressed", String(each === swatch)); });
    box.querySelector(".tint-name").textContent = swatch.getAttribute("aria-label");
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
  var TARGETS = { runner: ".run-wrap", cut: ".cut-btn", glass: ".glass-btn", guest: ".guest-btn", cover: ".cover", switch: ".tab-switch" };
  var MOVE_MS = 650, PRESS_MS = 180;
  function wait(ms) { return new Promise(function (done) { setTimeout(done, ms); }); }
  function send(el, type) { el.dispatchEvent(new MouseEvent(type, { bubbles: type !== "pointerenter" && type !== "pointerleave" })); }
  document.querySelectorAll("[data-state-loop]").forEach(function (box) {
    var kind = box.getAttribute("data-state-loop"), el = box.querySelector(TARGETS[kind]); if (!el) return;
    var cursor = document.createElement("span"); cursor.className = "loop-cursor"; cursor.setAttribute("aria-hidden", "true");
    cursor.innerHTML = '<svg viewBox="0 0 20 24" width="20" height="24"><path d="M3 2v17l4.6-4.4 3.1 6.9 2.6-1.1-3.1-6.8H16z" fill="#fff" stroke="#14171C" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    box.appendChild(cursor);
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
    (function watch() {
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
    })();
    // Off to the lower right, but never past the window's edge (a full-width button on a phone has no room beside it).
    var away = function () { var at = point(el, 1.15, 1.6), left = box.getBoundingClientRect().left; at[0] = Math.min(at[0], document.documentElement.clientWidth - left - 28); return at; };
    async function buttonLoop() {
      await moveTo(away(), true);
      for (;;) {
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
      await moveTo(point(el, 1.08, 1.5), true);
      for (;;) {
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
