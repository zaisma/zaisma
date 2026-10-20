import type { Env } from "./env.ts";
import { html, message, raw, scriptTags, securityHeaders, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { COMPONENT_GROUPS, type Component } from "./components/component.ts";
import { COMPONENTS, COMPONENT_SCRIPT, COMPONENT_STYLES, HEADER_SCRIPT, componentBySlug } from "./components/index.ts";
import { EDGE, WORDMARK, railMarkup } from "./components/foundations.ts";
import { cutButton, runButton } from "./components/actions.ts";
import { cutField, tabSwitch } from "./components/inputs.ts";
import { glassPane } from "./components/panes.ts";

/*
 * zaisma.com/design: every component of Zaisma's look in every state, light, dark and smoked, at phone width, and
 * over Zaisma's own background, a dark game, a bright game and a scene. It's rendered from the same code the pages
 * use (components/), so changing a component changes it here and everywhere it's used at once. Public, linked from
 * docs/DESIGN.md and the README, never from the footer or the menus, and not in the sitemap.
 */

export type GalleryBackdrop = "zaisma" | "dark-game" | "bright-game" | "scene";
const BACKDROPS: { backdrop: GalleryBackdrop; label: string }[] = [
  { backdrop: "zaisma", label: "Zaisma's own" },
  { backdrop: "dark-game", label: "Dark game" },
  { backdrop: "bright-game", label: "Bright game" },
  { backdrop: "scene", label: "Scene" },
];
type GalleryTheme = "light" | "dark";
type GalleryWidth = "wide" | "phone";

interface GalleryView {
  backdrop: GalleryBackdrop;
  theme: GalleryTheme;
  width: GalleryWidth;
}

/** The view a link asks for. The values are closed: anything else falls back to Zaisma's own, light and wide (it's a page, not the API). */
function viewOf(url: URL): GalleryView {
  const backdrop = url.searchParams.get("backdrop");
  return {
    backdrop: BACKDROPS.some((each) => each.backdrop === backdrop) ? (backdrop as GalleryBackdrop) : "zaisma",
    theme: url.searchParams.get("theme") === "dark" ? "dark" : "light",
    width: url.searchParams.get("width") === "phone" ? "phone" : "wide",
  };
}

/** The address of a view, with only what differs from the first view. */
function viewQuery(view: GalleryView): string {
  const query = new URLSearchParams();
  if (view.backdrop !== "zaisma") query.set("backdrop", view.backdrop);
  if (view.theme !== "light") query.set("theme", view.theme);
  if (view.width !== "wide") query.set("width", view.width);
  const text = query.toString();
  return text ? `?${text}` : "";
}

const frameSource = (slug: string, view: GalleryView) => `/design/frame/${slug}${viewQuery({ ...view, width: "wide" })}`;

/** The stage's own attributes: theme, backdrop, smoked glass over the dark game. A bright game keeps light glass whatever the theme. */
const stageAttributes = (view: GalleryView, width: GalleryWidth) =>
  html`class="stage${view.backdrop === "dark-game" ? " smoke" : ""}" data-backdrop="${view.backdrop}" data-theme-choice="${view.theme}" data-width="${width}"`;
const stageGlassAttributes = (view: GalleryView) => (view.backdrop === "bright-game" ? raw(' data-theme-choice="light"') : "");

function examples(each: Component): Raw {
  return html`<div class="examples">${each.examples.map((example) => html`<figure class="example${example.isWide ? " wide" : ""}"><div class="example-stage">${example.markup}</div><figcaption class="example-label">${example.label}</figcaption></figure>`)}</div>`;
}

const phoneFrame = (each: Component, view: GalleryView) =>
  html`<iframe class="phone-frame" src="${frameSource(each.slug, view)}" width="375" height="720" title="${each.name} at phone width" loading="lazy"></iframe>`;

/** The stand-in scene: a pane with a field, the runner and a cut button, resting on a rooftop when the scene is on. */
const SCENE_EXAMPLE = html`<figure class="example wide scene-example"><div class="scene-box" data-design-scene><canvas class="scene-canvas" aria-hidden="true"></canvas><div class="scene-layer" data-scene-layer>
${glassPane({ paneSize: "medium", sceneAnchor: "terrace-pane", label: "Sign in", body: html`<h2>Welcome back</h2>${cutField({ id: "scene-username", name: "username", label: "Username", type: "text", icon: "person", text: "emma_r", autocomplete: "off" })}` })}
${runButton("Sign in", { type: "button", isBig: true, sceneAnchor: "terrace-runner" })}
${cutButton("Make an account", { type: "button", sceneAnchor: "lower-roof" })}
</div></div><figcaption class="example-label">Resting in the scene · <span class="scene-mode" aria-live="polite">In front: starting</span></figcaption></figure>`;

function section(each: Component, view: GalleryView): Raw {
  return html`<section class="component-section" id="${each.slug}" aria-labelledby="${each.slug}-name" data-rail-mark="${each.name}">
<div class="component-head glass" data-glass data-glass-corners="14 6 14 6"><h2 id="${each.slug}-name"><a href="#${each.slug}">${each.name}</a></h2><p>${each.summary}</p>${each.hasSceneMode ? html`<p class="scene-note">It can rest in a scene. <a href="?backdrop=scene#glass-pane" data-gallery-view="backdrop=scene">See it on the rooftop</a>.</p>` : ""}</div>
${each.slug === "glass-pane" ? SCENE_EXAMPLE : ""}${examples(each)}<div class="phone-frames">${view.width === "phone" ? phoneFrame(each, view) : ""}</div>
</section>`;
}

function switches(view: GalleryView): Raw {
  const link = (change: Partial<GalleryView>) => `/design${viewQuery({ ...view, ...change })}`;
  return html`<div class="gallery-switches">
${tabSwitch({ label: "Background", switchSize: "small", tabs: BACKDROPS.map((each) => ({ label: each.label, href: link({ backdrop: each.backdrop }), isCurrent: view.backdrop === each.backdrop })) })}
${tabSwitch({ label: "Theme", switchSize: "small", tabs: [{ label: "Light", href: link({ theme: "light" }), isCurrent: view.theme === "light" }, { label: "Dark", href: link({ theme: "dark" }), isCurrent: view.theme === "dark" }] })}
${tabSwitch({ label: "Width", switchSize: "small", tabs: [{ label: "Wide", href: link({ width: "wide" }), isCurrent: view.width === "wide" }, { label: "Phone", href: link({ width: "phone" }), isCurrent: view.width === "phone" }] })}
</div>`;
}

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

/** GET /design: the gallery. */
export function designPage(env: Env, url: URL): Response {
  const view = viewOf(url);
  const components = COMPONENTS();
  const page = html`<!doctype html>
<html lang="en">
<head>
${head("Design · Zaisma")}
</head>
<body class="gallery">
<div id="stage" ${stageAttributes(view, view.width)}>
<div class="stage-glass"${stageGlassAttributes(view)}>
<header class="gallery-bar glass" data-glass data-glass-corners="16 6 16 6">${EDGE}<a class="logo" href="/" aria-label="Zaisma home">${WORDMARK}</a><span class="gallery-title">Design</span>${switches(view)}</header>
<div class="gallery-layout">
<div class="gallery-index glass" data-glass data-glass-corners="14 6 14 6"><nav class="gallery-index-in" aria-label="Components">${COMPONENT_GROUPS.map(({ group, name }) => {
    const inGroup = components.filter((each) => each.group === group);
    return inGroup.length ? html`<h2>${name}</h2><ul>${inGroup.map((each) => html`<li><a href="#${each.slug}">${each.name}</a></li>`)}</ul>` : "";
  })}</nav>${railMarkup("box")}</div>
<div class="gallery-groups">${tabSwitch({ label: "Groups", switchSize: "small", tabs: COMPONENT_GROUPS.filter(({ group }) => components.some((each) => each.group === group)).map(({ group, name }) => ({ label: name, href: `#${components.find((each) => each.group === group)!.slug}`, isCurrent: false })) })}</div>
<main class="gallery-main">
<h1 class="sr">Zaisma's design</h1>
${COMPONENT_GROUPS.map(({ group, name }) => {
    const inGroup = components.filter((each) => each.group === group);
    return inGroup.length ? html`<div class="gallery-group"><h2 class="group-name">${name}</h2>${inGroup.map((each) => section(each, view))}</div>` : "";
  })}
</main>
</div>
</div>
</div>
${railMarkup("page")}
${scriptTags(COMPONENT_SCRIPT, HEADER_SCRIPT, GALLERY_SCRIPT, DESIGN_SCENE_SCRIPT)}
</body>
</html>`;
  return new Response(page.html, { headers: securityHeaders(env, {}, false, [env.SITE_ORIGIN]) });
}

/** GET /design/frame/<slug>: one component's examples alone, for the gallery's 375px phone frames. */
export function designFramePage(env: Env, slug: string, url: URL): Response {
  const each = componentBySlug(slug);
  if (!each) return message(env, "No such component", "The gallery lists every component.", 404);
  const view = viewOf(url);
  const page = html`<!doctype html>
<html lang="en">
<head>
${head(`${each.name} · Design · Zaisma`)}
</head>
<body class="gallery frame-page">
<div id="stage" ${stageAttributes(view, "wide")}>
<div class="stage-glass"${stageGlassAttributes(view)}>
<main class="gallery-main"><h1 class="sr">${each.name}</h1>${examples(each)}</main>
</div>
</div>
${railMarkup("page")}
${scriptTags(COMPONENT_SCRIPT, HEADER_SCRIPT)}
</body>
</html>`;
  return new Response(page.html, { headers: securityHeaders(env, {}, false, [], [], "'self'") });
}

export const GALLERY_STYLES = `
/* The gallery: a stage with the backdrop behind everything, a glass bar with the switches, an index, and each component's examples in labelled cells. */
html { scroll-padding-top: 96px; }
body.gallery { margin: 0; min-height: 100vh; font: 15px/1.5 var(--body); }
.stage { min-height: 100vh; color: var(--ink); background: var(--page); }
.stage[data-backdrop="dark-game"] { background: #120a14 url(/design/dark-game.webp) center / cover fixed; }
.stage[data-backdrop="bright-game"] { background: #cfe5c4 url(/design/bright-game.webp) center / cover fixed; }
.stage[data-backdrop="scene"] { background: linear-gradient(180deg, #2E78DE 0%, #6FA6EC 45%, #A6CBF4 100%) fixed; }
.stage[data-backdrop="scene"][data-theme-choice="dark"] { background: linear-gradient(180deg, #050812 0%, #0B1226 55%, #142040 100%) fixed; }
/* Padding, not the bar's margin, keeps it off the top: a margin would collapse through the stage and show a strip of nothing above it. */
.stage-glass { min-height: 100vh; padding-top: 12px; color: var(--ink); }
/* The bar floats like the header: inset from the top and both sides, with the header's own padding around what's in it. */
.gallery-bar { position: sticky; top: 12px; z-index: 20; margin: 0 auto; width: calc(100% - 24px); max-width: 1480px; min-height: 68px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 22px; padding: 14px 16px 14px 26px;
  background-color: var(--glass-top); -webkit-backdrop-filter: blur(22px) saturate(1.7); backdrop-filter: blur(22px) saturate(1.7); }
.gallery-bar .logo svg { height: 24px; }
.gallery-title { font: 600 18px var(--display); color: var(--ink-2); padding-left: 14px; border-left: 1px solid var(--line); }
.gallery-switches { margin-left: auto; display: flex; flex-wrap: wrap; gap: 10px; }
.gallery-layout { max-width: 1480px; margin: 0 auto; padding: 18px 12px 80px; display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 18px; align-items: start; }
.gallery-index { position: sticky; top: 100px; display: flex; max-height: calc(100vh - 114px); }
.gallery-index-in { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 26px 18px 22px; }
.gallery-index > .rail { top: 16px; bottom: 16px; right: 4px; }
.gallery-index h2 { margin: 14px 0 4px; font: 600 13px var(--display); color: var(--muted); }
.gallery-index h2:first-child { margin-top: 0; }
.gallery-index ul { list-style: none; margin: 0; padding: 0; }
.gallery-index a { display: block; padding: 3px 0; font: 500 15px var(--display); color: var(--ink); text-decoration: none; }
.gallery-index a:hover { text-decoration: underline; text-decoration-color: var(--run); text-decoration-thickness: 2px; text-underline-offset: 4px; }
.gallery-index a:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.gallery-groups { display: none; }
.gallery-main { min-width: 0; }
.group-name { margin: 26px 0 10px; font: 600 15px var(--display); color: var(--ink); display: inline-block; padding: 4px 14px; background: var(--glass-tint); clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%); }
.gallery-group:first-of-type .group-name { margin-top: 0; }
.component-section { margin: 0 0 34px; scroll-margin-top: 96px; }
.component-head { padding: 16px 22px; margin-bottom: 12px; }
.component-head h2 { margin: 0; font: 600 24px var(--display); }
.component-head h2 a { color: inherit; text-decoration: none; }
.component-head p { margin: 4px 0 0; color: var(--ink-2); max-width: 75ch; }
.component-head .scene-note { font-size: 14px; color: var(--muted); }
.component-head a:not(h2 a) { color: var(--ink); text-decoration-color: var(--run); text-underline-offset: 3px; }
.examples { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.example { margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.example.wide { grid-column: 1 / -1; }
.example-stage { position: relative; min-height: 90px; display: flex; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: 12px; padding: 18px; }
.example-label { align-self: flex-start; font: 500 13px var(--display); color: var(--ink-2); padding: 2px 12px; background: var(--glass-tint);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); }
.example-pane { width: min(380px, 100%); padding: 22px 24px; display: flex; flex-direction: column; gap: 14px; }
.example-wide { width: 100%; padding: 20px 24px; }
.cover-sample { width: 260px; }
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
.phone-frames:empty { display: none; }
.phone-frame { display: block; width: 375px; height: 720px; max-width: 100%; border: 0; background: transparent; box-shadow: 0 0 0 1px var(--line), 0 18px 40px rgba(10,20,40,0.22); clip-path: polygon(0 18px, 18px 0, calc(100% - 9px) 0, 100% 9px, 100% calc(100% - 18px), calc(100% - 18px) 100%, 9px 100%, 0 calc(100% - 9px)); }
.stage[data-width="phone"] .examples, .stage[data-width="phone"] .scene-example { display: none; }
.stage[data-width="wide"] .phone-frames { display: none; }
/* The stand-in scene: only over the Scene backdrop. */
.scene-example { display: none; }
.stage[data-backdrop="scene"] .scene-example { display: flex; }
.scene-box { --horizon: 40%; position: relative; height: min(82vh, 760px); min-height: 560px; overflow: hidden;
  background: linear-gradient(180deg, #2E78DE 0%, #6FA6EC calc(var(--horizon) * 0.6), #A6CBF4 var(--horizon), #A6CBF4 100%); clip-path: polygon(0 18px, 18px 0, calc(100% - 9px) 0, 100% 9px, 100% calc(100% - 18px), calc(100% - 18px) 100%, 9px 100%, 0 calc(100% - 9px)); }
.stage[data-theme-choice="dark"] .scene-box { background: linear-gradient(180deg, #050812 0%, #0B1226 calc(var(--horizon) * 0.6), #142040 var(--horizon), #142040 100%); }
.scene-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.scene-layer { position: relative; z-index: 1; min-height: 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 24px; padding: 48px; }
/* The frame pages: one component, at the frame's own width. */
.frame-page .gallery-main { padding: 16px 12px; }
.frame-page .examples { grid-template-columns: minmax(0, 1fr); }
.frame-page .stand-in-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 760px) {
  .gallery-layout { grid-template-columns: minmax(0, 1fr); padding: 12px 10px 60px; }
  .gallery-index { display: none; }
  .gallery-groups { display: block; position: sticky; top: 8px; z-index: 15; overflow-x: auto; scrollbar-width: none; }
  .gallery-groups .tab-switch { width: max-content; }
  .gallery-bar { position: relative; top: 0; width: calc(100% - 20px); padding: 12px 12px 12px 18px; }
  .gallery-switches { margin-left: 0; }
  .examples { grid-template-columns: minmax(0, 1fr); }
  .stand-in-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stand-in-page { padding-top: 140px; }
  .header-frame { height: 320px; }
  .header-frame.tall { height: 560px; }
}
`;

/**
 * The gallery's switches swap the view in place, without a reload, and keep its address current, so any view can be sent.
 * Phone width swaps each component's examples for a 375px frame of it.
 */
export const GALLERY_SCRIPT = pageScript(
  "gallery",
  `(function () {
  var stage = document.getElementById("stage"), glassBox = stage.querySelector(".stage-glass");
  var view = { backdrop: stage.dataset.backdrop, theme: stage.dataset.themeChoice, width: stage.dataset.width };
  function query(v, keepWidth) {
    var q = new URLSearchParams();
    if (v.backdrop !== "zaisma") q.set("backdrop", v.backdrop);
    if (v.theme !== "light") q.set("theme", v.theme);
    if (keepWidth && v.width !== "wide") q.set("width", v.width);
    var text = q.toString(); return text ? "?" + text : "";
  }
  function frames() {
    document.querySelectorAll(".component-section").forEach(function (section) {
      var box = section.querySelector(".phone-frames"), src = "/design/frame/" + section.id + query(view, false), frame = box.querySelector("iframe");
      if (view.width !== "phone") return;
      if (!frame) {
        frame = document.createElement("iframe"); frame.className = "phone-frame"; frame.width = "375"; frame.height = "720"; frame.loading = "lazy";
        frame.title = section.querySelector("h2").textContent + " at phone width"; box.appendChild(frame);
      }
      if (frame.getAttribute("src") !== src) frame.setAttribute("src", src);
    });
  }
  function apply() {
    stage.dataset.backdrop = view.backdrop; stage.dataset.themeChoice = view.theme; stage.dataset.width = view.width;
    stage.classList.toggle("smoke", view.backdrop === "dark-game");
    if (view.backdrop === "bright-game") glassBox.setAttribute("data-theme-choice", "light"); else glassBox.removeAttribute("data-theme-choice");
    frames();
    // Every switch's links carry the rest of the view, so a link opened on its own lands on the same view.
    document.querySelectorAll(".gallery-switches a").forEach(function (link) {
      var url = new URL(link.href), change = {};
      url.searchParams.forEach(function (value, key) { change[key] = value; });
      var group = link.closest(".tab-switch").getAttribute("aria-label");
      var mine = group === "Background" ? { backdrop: change.backdrop || "zaisma" } : group === "Theme" ? { theme: change.theme || "light" } : { width: change.width || "wide" };
      var next = Object.assign({}, view, mine);
      link.href = "/design" + query(next, true);
      if ((mine.backdrop && mine.backdrop === view.backdrop) || (mine.theme && mine.theme === view.theme) || (mine.width && mine.width === view.width)) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
    history.replaceState(null, "", "/design" + query(view, true) + location.hash);
  }
  function choose(change) { Object.keys(change).forEach(function (key) { view[key] = change[key]; }); apply(); }
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest(".gallery-switches a, [data-gallery-view]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    event.preventDefault();
    var url = new URL(link.href), change = {};
    if (link.hasAttribute("data-gallery-view")) { new URLSearchParams(link.getAttribute("data-gallery-view")).forEach(function (value, key) { change[key] = value; }); }
    else { var group = link.closest(".tab-switch").getAttribute("aria-label"); change = group === "Background" ? { backdrop: url.searchParams.get("backdrop") || "zaisma" } : group === "Theme" ? { theme: url.searchParams.get("theme") || "light" } : { width: url.searchParams.get("width") || "wide" }; }
    choose(change);
    if (url.hash) { var target = document.getElementById(url.hash.slice(1)); if (target) target.scrollIntoView({ block: "start" }); history.replaceState(null, "", "/design" + query(view, true) + url.hash); }
  });
  apply();
})();
`,
);

/**
 * The stand-in scene, in raw WebGL with no library: a plain blue sky, the midday sun, crisp shadows and one white
 * low-poly rooftop with a terrace and a second, lower roof, on a calm faceted sea, under a camera that drifts slowly
 * around them in one 40 s loop. It holds a pane with a field and the runner on the terrace, and a cut button on the lower
 * roof, through zaismaScene.place (components/scene.ts). It's there to judge the behaviour; the real anchors go on the
 * sign-in city when that page is rebuilt.
 */
export const DESIGN_SCENE_SCRIPT = pageScript(
  "design-scene",
  `(function () {
  var box = document.querySelector("[data-design-scene]"), stage = document.getElementById("stage");
  if (!box || !stage) return;
  var canvas = box.querySelector("canvas"), layer = box.querySelector("[data-scene-layer]"), label = document.querySelector(".scene-mode");
  var root = document.documentElement;
  var fine = matchMedia("(pointer: fine)"), wide = matchMedia("(min-width: 760px)"), reduce = matchMedia("(prefers-reduced-motion: reduce)");
  var LOOP_SEC = 40, FOV = 40 * Math.PI / 180, WORLD_PER_PX = 0.0125;

  /* ---- Small vector and matrix helpers (column-major, like WebGL and CSS) ---- */
  function v(x, y, z) { return [x, y, z]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return mul(a, 1 / l); }
  function matMul(a, b) { var o = new Float32Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function perspective(fov, aspect, near, far) { var f = 1 / Math.tan(fov / 2), o = new Float32Array(16); o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = 2 * far * near / (near - far); return o; }
  function ortho(half, near, far) { var o = new Float32Array(16); o[0] = 1 / half; o[5] = 1 / half; o[10] = -2 / (far - near); o[14] = -(far + near) / (far - near); o[15] = 1; return o; }
  function basis(eye, target) { var back = norm(sub(eye, target)), right = norm(cross([0, 1, 0], back)), up = cross(back, right); return { right: right, up: up, back: back, eye: eye }; }
  function lookAt(b) { var e = b.eye; return new Float32Array([b.right[0], b.up[0], b.back[0], 0, b.right[1], b.up[1], b.back[1], 0, b.right[2], b.up[2], b.back[2], 0, -dot(b.right, e), -dot(b.up, e), -dot(b.back, e), 1]); }

  /* ---- The world: the rooftop's blocks, the terrace's parapets, and where each component rests ---- */
  var BLOCKS = [
    [v(-9, -2, -7), v(2.4, 4, 4.6)],       // the main block; its roof is the terrace
    [v(-9, 4, -7), v(2.4, 4.9, -6.6)],    // parapet, back
    [v(-9, 4, -7), v(-8.6, 4.9, 4.6)],    // parapet, left
    [v(2.0, 4, -7), v(2.4, 4.9, -1.4)],   // parapet, right, back half
    [v(-9, 4, 4.25), v(2.4, 4.35, 4.6)],  // a low lip along the front
    [v(-4.8, 4, -1.6), v(2.0, 4.7, 1.4)], // a raised deck on the terrace, where the pane stands
    [v(-8.2, 4, -6.2), v(-5.6, 6.4, -3.6)], // the stair house
    [v(2.4, -2, -4), v(11, 2.4, 6.2)],     // the lower block
    [v(2.4, 2.4, 5.85), v(11, 2.75, 6.2)] // its lip
  ];
  // Each component's resting place: the middle of its bottom edge, which way it faces (yaw), and how far it leans back.
  var RESTING = {
    "terrace-pane": { foot: v(-1.3, 4.72, 0.9), yaw: 0.1, lean: 0.22 },
    "terrace-runner": { foot: v(-0.7, 4.02, 3.6), yaw: 0.1, lean: 0.18 },
    "lower-roof": { foot: v(4.2, 2.42, 3.4), yaw: 0.06, lean: 0.2 }
  };
  var anchors = Object.keys(RESTING).map(function (name) { return { name: name, el: layer.querySelector('[data-scene-anchor="' + name + '"]'), rest: RESTING[name] }; }).filter(function (a) { return a.el; });
  // The component as a rectangle in the world, from its size on the page: its top left, and its right and down directions.
  function rectOf(anchor) {
    var w = anchor.el.offsetWidth * WORLD_PER_PX, h = anchor.el.offsetHeight * WORLD_PER_PX, r = anchor.rest;
    var face = v(Math.sin(r.yaw), 0, Math.cos(r.yaw)), right = v(Math.cos(r.yaw), 0, -Math.sin(r.yaw));
    var up = norm(add(mul(v(0, 1, 0), Math.cos(r.lean)), mul(face, -Math.sin(r.lean))));
    var topLeft = add(sub(r.foot, mul(right, w / 2)), mul(up, h));
    return { origin: topLeft, right: right, down: mul(up, -1), w: w, h: h, centre: add(r.foot, mul(up, h / 2)), face: norm(cross(right, up)) };
  }

  /* ---- GL ---- */
  var gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" }), reason = "";
  var derivatives = gl && gl.getExtension("OES_standard_derivatives");
  function compile(type, text) { var s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; }
  function program(vs, fs) { var a = compile(gl.VERTEX_SHADER, vs), b = compile(gl.FRAGMENT_SHADER, fs); if (!a || !b) return null; var p = gl.createProgram(); gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p); return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null; }
  var WAVE = "float wave(vec2 p, float t) { return 0.22 * sin(p.x * 0.16 + t * 0.55) + 0.16 * sin(p.y * 0.23 - t * 0.42) + 0.08 * sin((p.x + p.y) * 0.37 + t * 0.9); }\\n";
  var MAIN_VS = "attribute vec3 aPos; attribute vec3 aNormal; attribute float aSea; uniform mat4 uViewProj; uniform mat4 uLight; uniform float uTime; varying vec3 vWorld; varying vec3 vNormal; varying vec4 vLight; varying float vSea;\\n" + WAVE +
    "void main() { vec3 p = aPos; if (aSea > 0.5) p.y += wave(p.xz, uTime); vWorld = p; vNormal = aNormal; vSea = aSea; vLight = uLight * vec4(p, 1.0); gl_Position = uViewProj * vec4(p, 1.0); }";
  var MAIN_FS = (derivatives ? "#extension GL_OES_standard_derivatives : enable\\n" : "") + "precision highp float; uniform sampler2D uShadow; uniform vec3 uSun; uniform vec3 uSunColor; uniform vec3 uSky; uniform vec3 uFog; uniform vec3 uEye; uniform float uTexel; varying vec3 vWorld; varying vec3 vNormal; varying vec4 vLight; varying float vSea;\\n" +
    "float unpack(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }\\n" +
    "float lit(vec3 n) { vec3 l = vLight.xyz / vLight.w * 0.5 + 0.5; if (l.x < 0.0 || l.x > 1.0 || l.y < 0.0 || l.y > 1.0) return 1.0; float bias = 0.0015 + 0.003 * (1.0 - max(dot(n, uSun), 0.0)); float s = 0.0;\\n" +
    "  for (int i = 0; i < 4; i++) { vec2 o = vec2(float(i / 2) - 0.5, float(i - (i / 2) * 2) - 0.5) * uTexel; s += l.z - bias > unpack(texture2D(uShadow, l.xy + o)) ? 0.0 : 1.0; } return s / 4.0; }\\n" +
    "void main() { vec3 n = normalize(vNormal);\\n" +
    (derivatives ? "  if (vSea > 0.5) { n = normalize(cross(dFdx(vWorld), dFdy(vWorld))); if (n.y < 0.0) n = -n; }\\n" : "") +
    "  vec3 albedo = vSea > 0.5 ? vec3(0.05, 0.3, 0.5) : vec3(0.86, 0.87, 0.88); float d = max(dot(n, uSun), 0.0); float shade = lit(n);\\n" +
    "  vec3 c = albedo * (uSky * (0.55 + 0.45 * n.y) + uSunColor * d * shade);\\n" +
    "  vec3 view = normalize(uEye - vWorld); if (vSea > 0.5) { float spec = pow(max(dot(reflect(-uSun, n), view), 0.0), 60.0); c += uSunColor * spec * 0.9 * shade; c = mix(c, uSky * 0.9, pow(1.0 - max(dot(n, view), 0.0), 4.0) * 0.6); }\\n" +
    "  float fog = 1.0 - exp(-pow(length(uEye - vWorld) * 0.012, 1.6)); gl_FragColor = vec4(mix(c, uFog, fog), 1.0); }";
  var DEPTH_VS = "attribute vec3 aPos; uniform mat4 uLight; varying float vDepth; void main() { gl_Position = uLight * vec4(aPos, 1.0); vDepth = gl_Position.z * 0.5 + 0.5; }";
  var DEPTH_FS = "precision highp float; varying float vDepth; void main() { vec4 e = fract(vDepth * vec4(1.0, 255.0, 65025.0, 16581375.0)); e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0); gl_FragColor = e; }";
  var mainProgram = gl && program(MAIN_VS, MAIN_FS), depthProgram = gl && program(DEPTH_VS, DEPTH_FS);
  if (!gl || !mainProgram || !depthProgram) reason = "no 3D";

  var SHADOW_SIZE = 2048, solid, sea, casters, shadowTexture, shadowBuffer;
  function boxTriangles(lo, hi, out) {
    var x0 = lo[0], y0 = lo[1], z0 = lo[2], x1 = hi[0], y1 = hi[1], z1 = hi[2];
    var faces = [
      [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
      [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]]
    ];
    faces.forEach(function (f) { [0, 1, 2, 0, 2, 3].forEach(function (i) { out.push(f[i][0], f[i][1], f[i][2], f[4][0], f[4][1], f[4][2], 0); }); });
  }
  function buffer(data) { var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); return { buffer: b, count: data.length / 7 }; }
  if (!reason) {
    var blocks = []; BLOCKS.forEach(function (b) { boxTriangles(b[0], b[1], blocks); }); solid = buffer(blocks);
    var water = [], cells = 120, span = 700, step = span / cells;
    for (var i = 0; i < cells; i++) for (var j = 0; j < cells; j++) {
      var x = -span / 2 + i * step, z = -span / 2 + j * step;
      [[x, z], [x, z + step], [x + step, z + step], [x, z], [x + step, z + step], [x + step, z]].forEach(function (p) { water.push(p[0], 0, p[1], 0, 1, 0, 1); });
    }
    sea = buffer(water);
    casters = { buffer: gl.createBuffer(), count: 0 };
    shadowTexture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHADOW_SIZE, SHADOW_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST); });
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE); });
    var depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SHADOW_SIZE, SHADOW_SIZE);
    shadowBuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, shadowBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function bind(p, item) {
    gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer);
    var pos = gl.getAttribLocation(p, "aPos"), normal = gl.getAttribLocation(p, "aNormal"), seaAttribute = gl.getAttribLocation(p, "aSea");
    gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 28, 0);
    if (normal >= 0) { gl.enableVertexAttribArray(normal); gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 28, 12); }
    if (seaAttribute >= 0) { gl.enableVertexAttribArray(seaAttribute); gl.vertexAttribPointer(seaAttribute, 1, gl.FLOAT, false, 28, 24); }
  }

  /* ---- The sun (by day) or the moon (in the dark theme) ---- */
  var SUN = norm(v(0.62, 0.78, 0.5));
  function lighting() {
    var night = stage.dataset.themeChoice === "dark";
    return night ? { sunColor: [0.42, 0.5, 0.72], sky: [0.1, 0.13, 0.24], fog: [0.078, 0.125, 0.25] } : { sunColor: [0.84, 0.8, 0.72], sky: [0.4, 0.5, 0.68], fog: [0.65, 0.8, 0.96] };
  }

  /* ---- Is the scene on? Only with WebGL, a fine pointer, a wide window, no reduced motion and a steady frame rate ---- */
  var running = false, slowDevice = false, frameId = 0, startedAt = 0, last = 0, frameAverage = 1 / 60, slowFor = 0, renderScale = Math.min(1.5, window.devicePixelRatio || 1);
  function whyInFront() {
    if (reason) return reason;
    if (!fine.matches || !wide.matches) return "a phone or small window";
    if (reduce.matches) return "reduced motion";
    if (slowDevice) return "a slow device";
    return "";
  }
  function decide() {
    var why = running ? whyInFront() : "not shown";
    if (running && !why) root.setAttribute("data-scene", "on"); else root.removeAttribute("data-scene");
    if (label) label.textContent = why ? "In front: " + why : "In the scene";
  }
  [fine, wide, reduce].forEach(function (query) { if (query.addEventListener) query.addEventListener("change", function () { decide(); if (running) loop(performance.now()); }); });

  function resize() {
    var w = Math.max(2, Math.round(box.clientWidth * renderScale)), h = Math.max(2, Math.round(box.clientHeight * renderScale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  // Is anything solid between the camera and this point? (Rays against the blocks, the slab method.)
  function hidden(eye, point) {
    var dir = sub(point, eye), far = Math.sqrt(dot(dir, dir)); dir = mul(dir, 1 / far);
    return BLOCKS.some(function (b) {
      var near = 0, end = far - 0.3;
      for (var k = 0; k < 3; k++) {
        if (Math.abs(dir[k]) < 1e-9) { if (eye[k] < b[0][k] || eye[k] > b[1][k]) return false; continue; }
        var t0 = (b[0][k] - eye[k]) / dir[k], t1 = (b[1][k] - eye[k]) / dir[k]; if (t0 > t1) { var s = t0; t0 = t1; t1 = s; }
        near = Math.max(near, t0); end = Math.min(end, t1); if (near > end) return false;
      }
      return true;
    });
  }

  function draw(now) {
    resize();
    var seconds = reduce.matches || slowDevice ? 0 : (now - startedAt) / 1000, loopAngle = 2 * Math.PI * (seconds % LOOP_SEC) / LOOP_SEC;
    var boxW = box.clientWidth, boxH = box.clientHeight, focal = (boxH / 2) / Math.tan(FOV / 2);
    // The camera stays just far enough that every component shows at least its flat size, drifting slowly around the rooftop.
    var target = v(0.4, 4.6, 2.4), distance = Math.min(30, focal * WORLD_PER_PX * 0.98);
    var yaw = 0.12 + 0.2 * Math.sin(loopAngle), pitch = 0.24 + 0.04 * Math.sin(2 * loopAngle + 0.6);
    var eye = add(target, v(distance * Math.sin(yaw) * Math.cos(pitch), distance * Math.sin(pitch), distance * Math.cos(yaw) * Math.cos(pitch)));
    // The sky behind the canvas meets the sea's haze at the horizon, wherever the camera's pitch puts it.
    box.style.setProperty("--horizon", ((boxH / 2 - focal * Math.tan(pitch)) / boxH * 100).toFixed(2) + "%");
    var cam = basis(eye, target), view = lookAt(cam), projection = perspective(FOV, boxW / boxH, 0.5, 400), viewProj = matMul(projection, view);
    var lightCam = basis(add(v(1.5, 0, 1), mul(SUN, 60)), v(1.5, 0, 1)), lightMatrix = matMul(ortho(26, 1, 140), lookAt(lightCam));
    var light = lighting();

    // The components' resting rectangles cast shadows too.
    var rects = anchors.map(function (a) { return { anchor: a, rect: rectOf(a) }; }), quads = [];
    rects.forEach(function (r) {
      var o = r.rect.origin, x = mul(r.rect.right, r.rect.w), y = mul(r.rect.down, r.rect.h), corners = [o, add(o, x), add(add(o, x), y), add(o, y)];
      [0, 1, 2, 0, 2, 3].forEach(function (i) { quads.push(corners[i][0], corners[i][1], corners[i][2], 0, 0, 1, 0); });
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, casters.buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quads), gl.DYNAMIC_DRAW); casters.count = quads.length / 7;

    gl.enable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowBuffer); gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(depthProgram); gl.uniformMatrix4fv(gl.getUniformLocation(depthProgram, "uLight"), false, lightMatrix);
    gl.disable(gl.CULL_FACE);
    bind(depthProgram, solid); gl.drawArrays(gl.TRIANGLES, 0, solid.count);
    bind(depthProgram, casters); gl.drawArrays(gl.TRIANGLES, 0, casters.count);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(mainProgram);
    var u = function (name) { return gl.getUniformLocation(mainProgram, name); };
    gl.uniformMatrix4fv(u("uViewProj"), false, viewProj); gl.uniformMatrix4fv(u("uLight"), false, lightMatrix);
    gl.uniform1f(u("uTime"), seconds); gl.uniform3fv(u("uSun"), SUN); gl.uniform3fv(u("uSunColor"), light.sunColor); gl.uniform3fv(u("uSky"), light.sky); gl.uniform3fv(u("uFog"), light.fog);
    gl.uniform3fv(u("uEye"), eye); gl.uniform1f(u("uTexel"), 1 / SHADOW_SIZE);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadowTexture); gl.uniform1i(u("uShadow"), 0);
    bind(mainProgram, solid); gl.drawArrays(gl.TRIANGLES, 0, solid.count);
    bind(mainProgram, sea); gl.drawArrays(gl.TRIANGLES, 0, sea.count);

    if (root.getAttribute("data-scene") !== "on") return;
    // Each component onto its resting rectangle, in the layer's 3D space: x and y in pixels from the layer's top left, z toward you,
    // with the layer's perspective set to the camera's focal length, so the layer and the canvas line up.
    layer.style.perspective = focal.toFixed(2) + "px";
    var cx = boxW / 2, cy = boxH / 2, s = 1 / WORLD_PER_PX;
    function toLayer(p) { var d = sub(p, cam.eye); return [cx + s * dot(d, cam.right), cy - s * dot(d, cam.up), focal + s * dot(d, cam.back)]; }
    function stepToLayer(d) { return [s * dot(d, cam.right), -s * dot(d, cam.up), s * dot(d, cam.back)]; }
    var sunOnScreen = [dot(SUN, cam.right), dot(SUN, cam.up)], sunLength = Math.max(1e-6, Math.hypot(sunOnScreen[0], sunOnScreen[1]));
    rects.forEach(function (r) {
      var o = toLayer(r.rect.origin), x = stepToLayer(mul(r.rect.right, WORLD_PER_PX)), y = stepToLayer(mul(r.rect.down, WORLD_PER_PX));
      var toCamera = dot(sub(cam.eye, r.rect.centre), r.rect.face) > 0, inFront = dot(sub(r.rect.centre, cam.eye), cam.back) < -1;
      window.zaismaScene.place(r.anchor.name, {
        matrix: [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, 0, 0, 1, 0, o[0], o[1], o[2], 1],
        lightX: sunOnScreen[0] / sunLength, lightY: sunOnScreen[1] / sunLength,
        isVisible: toCamera && inFront && !hidden(cam.eye, r.rect.centre)
      });
    });
  }

  function loop(now) {
    cancelAnimationFrame(frameId);
    if (!running || reason) return;
    draw(now);
    var raw = (now - (last || now)) / 1000; last = now;
    // Only a steady slowdown (under about 42 frames a second for two seconds running) lowers the resolution, and at the lowest step
    // the components come back in front and the scene holds still. A one-off hitch never does.
    if (now - startedAt > 1500 && raw > 0 && raw < 0.25 && !slowDevice) {
      frameAverage = frameAverage * 0.95 + raw * 0.05;
      slowFor = frameAverage > 1 / 42 ? slowFor + raw : 0;
      if (slowFor > 2) { slowFor = 0; frameAverage = 1 / 60; if (renderScale > 0.55) renderScale = Math.max(0.55, renderScale - 0.15); else { slowDevice = true; decide(); } }
    }
    if (reduce.matches || slowDevice || document.hidden) return;
    frameId = requestAnimationFrame(loop);
  }
  function start() { if (running) return; running = true; startedAt = performance.now(); last = 0; decide(); if (!reason) loop(performance.now()); }
  function stop() { running = false; cancelAnimationFrame(frameId); decide(); }
  function follow() { if (stage.dataset.backdrop === "scene" && stage.dataset.width !== "phone") start(); else stop(); }
  new MutationObserver(follow).observe(stage, { attributes: true, attributeFilter: ["data-backdrop", "data-width", "data-theme-choice"] });
  new MutationObserver(function () { if (running) loop(performance.now()); }).observe(stage, { attributes: true, attributeFilter: ["data-theme-choice"] });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && running) { last = 0; loop(performance.now()); } });
  if (window.ResizeObserver) new ResizeObserver(function () { if (running) loop(performance.now()); }).observe(box);
  follow();
})();
`,
);
