import { html, raw, type Raw } from "../html.ts";
import { component } from "./component.ts";
import { EDGE, ago, icon, type IconName } from "./foundations.ts";
import { pictureFrame, type GlanceFacts } from "./data.ts";
import { runButton } from "./actions.ts";
import { cutField } from "./inputs.ts";

/*
 * Panes: Zaisma's glass as a sheet that holds things (the sign-in's pane), the account menu that hangs
 * from a button, and a game's cover. From the sign-in, header and home drafts.
 */

const PANE_SIZES = { small: 320, medium: 480, large: 720 } as const;

export interface GlassPaneOptions {
  paneSize: "small" | "medium" | "large" | "full";
  body: Raw;
  /** Cut corners: top left, top right, bottom right, bottom left. Panes are 18 and 9. */
  corners?: [number, number, number, number];
  label?: string;
}

/** A pane of Zaisma's glass: cut corners, a drawn rim, clear glass. Long content scrolls inside it, so nothing in it shrinks. */
export function glassPane(options: GlassPaneOptions): Raw {
  const corners = (options.corners ?? [18, 9, 18, 9]).join(" ");
  const pane = html`<section class="glass glass-pane ${options.paneSize}" data-glass data-glass-corners="${corners}"${options.label ? html` aria-label="${options.label}"` : ""}>${EDGE}<div class="pane-in">${options.body}</div></section>`;
  return pane;
}

export type MenuItem = { kind: "link"; label: string; icon: IconName; href: string } | { kind: "form"; label: string; icon: IconName; action: string } | { kind: "rule" };

/** The account pane as a menu any button can open (aria-controls its id): the same glass, with the orange line on an item's slanted edge. */
export function accountMenu(options: { id: string; label: string; who?: { name: string; note: string }; items: MenuItem[]; isOpen?: boolean }): Raw {
  return html`<div class="menu glass${options.isOpen ? "" : " shut"}" id="${options.id}" role="menu" aria-label="${options.label}" aria-hidden="${options.isOpen ? "false" : "true"}" data-glass data-glass-corners="14 4 14 4">${EDGE}${options.who ? html`<div class="who"><strong>${options.who.name}</strong><span>${options.who.note}</span></div>` : ""}${options.items.map((menuItem) =>
    menuItem.kind === "rule"
      ? raw('<hr role="separator">')
      : menuItem.kind === "link"
        ? html`<a href="${menuItem.href}" role="menuitem" tabindex="-1">${icon(menuItem.icon)}${menuItem.label}</a>`
        : html`<form method="post" action="${menuItem.action}"><button type="submit" role="menuitem" tabindex="-1">${icon(menuItem.icon)}${menuItem.label}</button></form>`,
  )}</div>`;
}

/** The same facts as the glance list, short, under a cover: when you played, an update or friends on the left, players now on the right. */
function coverFacts(facts: GlanceFacts): Raw {
  const nowMs = Date.now();
  const friends = facts.friends ?? [];
  const left =
    facts.playedAtMs !== undefined
      ? html`<span class="when">${icon("clock")}<span><span class="sr">Played </span>${ago(nowMs - facts.playedAtMs)}</span></span>${facts.updatedAtMs !== undefined ? html`<span class="chip">Updated</span>` : ""}`
      : friends.length
        ? html`<span class="friends"><span class="faces">${friends.map((friend) => pictureFrame(friend.username, "xs"))}</span><span>${friends.map((friend) => friend.username).join(", ")}<span class="sr"> playing</span></span></span>`
        : "";
  return html`<div class="cover-meta">${left}${facts.playerCount !== undefined ? html`<span class="count">${icon("people")}<span>${facts.playerCount.toLocaleString("en-US")}<span class="sr"> playing now</span></span></span>` : ""}</div>`;
}

/** A game's cover: the studio's art alone, bare. The orange line draws in under it on point and runs out to the right on leave. */
export function gameCover(options: { title: string; imageUrl: string; href: string; facts: GlanceFacts; isCurrent?: boolean }): Raw {
  const isUpdated = options.facts.updatedAtMs !== undefined && options.facts.playedAtMs !== undefined;
  return html`<div class="cover"${options.isCurrent ? raw(' aria-current="true"') : ""}><a class="cover-art" href="${options.href}" aria-label="${options.title}${isUpdated ? ", updated" : ""}"><img src="${options.imageUrl}" alt="" loading="lazy" decoding="async"></a><span class="cover-bar" aria-hidden="true"></span>${coverFacts(options.facts)}</div>`;
}

/**
 * Menus: a button with aria-controls and aria-expanded opens the menu it names. It hangs just under the header
 * slab when the button is in the header, otherwise just under the button, at the button's right end. Escape,
 * a press elsewhere or choosing an item closes it; the arrow keys move through it.
 */
export const MENU_SCRIPT = `/* menus */(function () {
  // Where a fixed menu's coordinates start: the viewport, or the nearest ancestor that holds fixed things (a transform or filter), like the gallery's frames.
  function fixedOrigin(el) {
    for (var p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      var style = getComputedStyle(p);
      if (style.transform !== "none" || style.filter !== "none" || /paint|layout|strict|content/.test(style.contain || "")) return p.getBoundingClientRect();
    }
    return { left: 0, top: 0 };
  }
  function buttonOf(menu) { return document.querySelector('[aria-controls="' + menu.id + '"][aria-expanded]'); }
  function items(menu) { return Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]')); }
  function place(menu) {
    var button = buttonOf(menu); if (!button || menu.classList.contains("shut")) return;
    var origin = fixedOrigin(menu), r = button.getBoundingClientRect(), slab = button.closest(".top"), below = slab ? slab.getBoundingClientRect().bottom : r.bottom;
    var right = r.right - origin.left, width = menu.offsetWidth, room = (origin.width || window.innerWidth) - 8;
    menu.style.top = (below - origin.top + 8) + "px";
    menu.style.left = Math.max(8, Math.min(room - width, right - width)) + "px";
  }
  function toggle(menu, open, focusFirst) {
    var button = buttonOf(menu);
    if (button) button.setAttribute("aria-expanded", String(open));
    menu.classList.toggle("shut", !open); menu.setAttribute("aria-hidden", String(!open));
    if (open) { place(menu); if (focusFirst && items(menu)[0]) items(menu)[0].focus({ preventScroll: true }); }
  }
  var menus = Array.prototype.slice.call(document.querySelectorAll('.menu[role="menu"]'));
  menus.forEach(function (menu) {
    if (!menu.classList.contains("shut")) requestAnimationFrame(function () { place(menu); });
    menu.addEventListener("keydown", function (event) {
      var list = items(menu), at = list.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); list[(at + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length].focus(); }
      if (event.key === "Home" || event.key === "End") { event.preventDefault(); list[event.key === "Home" ? 0 : list.length - 1].focus(); }
      if (event.key === "Escape" || event.key === "Tab") { toggle(menu, false); if (event.key === "Escape") { var button = buttonOf(menu); if (button) button.focus(); } }
    });
    menu.addEventListener("click", function (event) { if (event.target.closest('[role="menuitem"]')) toggle(menu, false); });
  });
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[aria-controls][aria-expanded]");
    var menu = button && document.getElementById(button.getAttribute("aria-controls"));
    if (!menu || !menu.matches('.menu[role="menu"]')) return;
    toggle(menu, button.getAttribute("aria-expanded") !== "true", event.detail === 0);
  });
  document.addEventListener("pointerdown", function (event) {
    menus.forEach(function (menu) { var button = buttonOf(menu); if (!menu.classList.contains("shut") && !menu.contains(event.target) && !(button && button.contains(event.target))) toggle(menu, false); });
  });
  function placeAll() { menus.forEach(place); }
  window.addEventListener("resize", placeAll);
  window.addEventListener("scroll", placeAll, { passive: true, capture: true });
})();
`;

const MENU_STYLES = `
/* The account pane: the header's glass, hanging just under it at its right end. */
.menu { position: fixed; z-index: 11; width: 260px; padding: 18px 14px 14px; --glass-tint: var(--glass-menu);
  clip-path: polygon(0 14px, 14px 0, calc(100% - 4px) 0, 100% 4px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 4px 100%, 0 calc(100% - 4px));
  transform-origin: top right; transition: var(--glass-transition), opacity 0.25s, transform 0.35s cubic-bezier(.2,.8,.2,1); }
.menu.shut { opacity: 0; transform: translateY(-6px) scale(0.98); pointer-events: none; visibility: hidden; transition: var(--glass-transition), opacity 0.25s, transform 0.35s cubic-bezier(.2,.8,.2,1), visibility 0s 0.35s; }
.menu .who { display: flex; flex-direction: column; padding: 0 10px 12px; margin-bottom: 6px; border-bottom: 1px solid var(--line); }
.menu .who strong { font: 600 17px var(--display); }
.menu .who span { color: var(--muted); font-size: 13px; }
.menu form { margin: 0; }
.menu [role="menuitem"] { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; height: 42px; padding: 0 10px 0 14px; border: 0; background: none; cursor: pointer;
  color: var(--ink); text-decoration: none; text-align: left; font: 500 15px var(--display);
  clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); transition: background 0.2s; }
.menu [role="menuitem"] .ico { color: var(--ink-2); }
.menu [role="menuitem"]::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 11px; background: var(--run); clip-path: polygon(8px 0, 11px 0, 3px 100%, 0 100%); opacity: 0; transition: opacity 0.2s; }
.menu [role="menuitem"]:hover, .menu [role="menuitem"]:focus-visible { background: var(--show-on); outline: none; }
.menu [role="menuitem"]:hover::before, .menu [role="menuitem"]:focus-visible::before { opacity: 1; }
.menu hr { border: 0; border-top: 1px solid var(--line); margin: 6px 0; }
@media (prefers-reduced-motion: reduce) { .menu { transition: var(--glass-transition); } }
`;

const PANE_STYLES = `
/* The pane: Zaisma's glass, the same as the home's and the header's. No sheen. Small, medium and large are 320, 480 and 720 wide; full is the whole width. */
.glass-pane { display: flex; flex-direction: column; max-width: 100%; }
.glass-pane.small { width: ${PANE_SIZES.small}px; }
.glass-pane.medium { width: ${PANE_SIZES.medium}px; }
.glass-pane.large { width: ${PANE_SIZES.large}px; }
.glass-pane.full { width: 100%; }
.glass-pane > .pane-in { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; padding: 28px 30px 26px 32px; margin-right: 10px; }
/* Nothing in the pane shrinks when its content is long: it scrolls instead. */
.glass-pane > .pane-in > * { flex-shrink: 0; }
.glass-pane h2 { margin: 0; font: 600 26px/1.1 var(--display); text-wrap: balance; }
.glass-pane p { margin: 0; color: var(--ink-2); }
/* The scrollbar is a sliver of the same glass: a clear track, a bright bevelled thumb, kept clear of the cut corners. */
@supports not selector(::-webkit-scrollbar) { .glass-pane > .pane-in { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.9) rgba(255,255,255,0.14); } }
.glass-pane > .pane-in::-webkit-scrollbar { width: 12px; }
.glass-pane > .pane-in::-webkit-scrollbar-track { background: linear-gradient(90deg, rgba(255,255,255,0) 3px, rgba(255,255,255,0.16) 3px, rgba(255,255,255,0.16) 9px, rgba(255,255,255,0) 9px); margin-block: 34px; }
.glass-pane > .pane-in::-webkit-scrollbar-thumb { border: 3px solid transparent; background-clip: padding-box; background-color: rgba(255,255,255,0.78);
  background-image: linear-gradient(90deg, rgba(255,255,255,1), rgba(222,233,248,0.7)); box-shadow: inset 0 0 0 1px rgba(26,44,80,0.16); }
.glass-pane > .pane-in::-webkit-scrollbar-thumb:hover { background-color: rgba(255,255,255,0.95); }
.glass-pane > .pane-in::-webkit-scrollbar-button { display: none; }
@media (max-width: 760px) { .glass-pane > .pane-in { padding: 22px 20px 20px; margin-right: 0; } }
`;

const COVER_STYLES = `
/* Covers are the studios' art alone: no rim, no glass, nothing drawn on them. */
.cover { position: relative; min-width: 0; }
.cover-art { position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; background: rgba(20,30,50,0.12);
  box-shadow: 0 4px 10px rgba(10,20,40,0.16); transition: box-shadow 0.2s ease-out; }
.cover-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.cover:hover .cover-art, .cover-art:focus-visible { box-shadow: 0 6px 14px rgba(10,20,40,0.24); }
.cover-art:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
/* The orange line under a cover: it draws in from the left the moment you point at a cover, with a light running ahead along it,
   and stays under the game in the pane. Leaving, it runs on out to the right, quicker than it came, as if it moved on to the next cover. */
.cover-bar { position: relative; display: block; height: 4px; margin-top: 6px; overflow: hidden; clip-path: polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%);
  background: linear-gradient(90deg, #E9820C, var(--run) 40%, #FFB54D);
  transform: scaleX(0); transform-origin: right; transition: transform 0.22s cubic-bezier(.4,0,1,1); }
.cover-bar::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 38%; opacity: 0;
  background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,246,228,0.95) 70%, rgba(255,255,255,0)); }
.cover:hover .cover-bar, .cover.is-pointed .cover-bar, .cover[aria-current="true"] .cover-bar, .cover-art:focus-visible + .cover-bar { transform: scaleX(1); transform-origin: left; transition: transform 0.42s cubic-bezier(.2,.8,.2,1); }
.cover:hover .cover-bar::after, .cover.is-pointed .cover-bar::after, .cover[aria-current="true"] .cover-bar::after, .cover-art:focus-visible + .cover-bar::after { animation: cover-glint 0.7s cubic-bezier(.3,.6,.3,1) both; }
@keyframes cover-glint { 0% { transform: translateX(-100%); opacity: 1; } 75% { opacity: 1; } 100% { transform: translateX(270%); opacity: 0; } }
/* Under a cover: what concerns you on the left (when you played, an update, friends), players now on the right. */
.cover-meta { display: flex; align-items: center; gap: 8px; min-height: 22px; margin-top: 2px; font: 500 13px/1.3 var(--display); color: var(--muted); white-space: nowrap; }
.cover-meta .ico { width: 15px; height: 15px; stroke-width: 1.5; }
.cover-meta .when, .cover-meta .count, .cover-meta .friends { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.cover-meta .friends { color: var(--ink); font-weight: 600; overflow: hidden; }
.cover-meta .friends > span:last-child { overflow: hidden; text-overflow: ellipsis; }
.cover-meta .frame.xs { --frame: 18px; --frame-cut: 4px; }
.cover-meta .frame.xs .av::first-letter { font-size: 10px; }
.cover-meta .when > span { overflow: hidden; text-overflow: ellipsis; }
.cover-meta .count { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--ink-2); flex: none; }
@media (prefers-reduced-motion: reduce) { .cover-art, .cover-bar { transition: none !important; } .cover-bar::after { animation: none !important; } }
`;

const HOUR_MS = 3_600_000;
/** The home draft's stand-in games, painted once as covers (brand/design/covers/). Times are how long ago, worked out when the page is made. */
interface StandInGame {
  slug: string;
  title: string;
  playerCount: number;
  playedAgoDurationMs?: number;
  updatedAgoDurationMs?: number;
  friends?: { username: string }[];
}
export const STAND_IN_GAMES: StandInGame[] = [
  { slug: "ashen-crown", title: "Ashen Crown", playerCount: 1204, playedAgoDurationMs: 2 * HOUR_MS, updatedAgoDurationMs: HOUR_MS },
  { slug: "neon-drift", title: "Neon Drift", playerCount: 3870, friends: [{ username: "Liam" }, { username: "Sofia" }] },
  { slug: "hollow-tide", title: "Hollow Tide", playerCount: 412 },
  { slug: "verdant", title: "Verdant", playerCount: 96, playedAgoDurationMs: 50 * HOUR_MS },
  { slug: "iron-vigil", title: "Iron Vigil", playerCount: 8214, friends: [{ username: "Noah" }] },
  { slug: "glasswing", title: "Glasswing", playerCount: 655 },
  { slug: "frostline", title: "Frostline", playerCount: 2290 },
  { slug: "kestrel", title: "Kestrel", playerCount: 1730, friends: [{ username: "Mia" }] },
];

/** The stand-in covers, made once as the module loads. */
export const STAND_IN_COVERS: Record<string, Raw> = Object.fromEntries(
  STAND_IN_GAMES.map((game) => {
    const nowMs = Date.now();
    const facts: GlanceFacts = {
      playerCount: game.playerCount,
      friends: game.friends,
      playedAtMs: game.playedAgoDurationMs === undefined ? undefined : nowMs - game.playedAgoDurationMs,
      updatedAtMs: game.updatedAgoDurationMs === undefined ? undefined : nowMs - game.updatedAgoDurationMs,
    };
    return [game.slug, gameCover({ title: game.title, imageUrl: `/design/covers/${game.slug}.webp`, href: `#${game.slug}`, facts })];
  }),
);
const standInCovers = (slugs: string[]) => html`${slugs.map((slug) => STAND_IN_COVERS[slug])}`;

const signInBody = (idPrefix: string) =>
  html`<h2>Welcome back</h2>${cutField({ id: `${idPrefix}-username`, name: "username", label: "Username", type: "text", icon: "person", text: "emma_r", autocomplete: "username" })}${cutField({ id: `${idPrefix}-password`, name: "password", label: "Password", type: "password", icon: "lock", text: "correct-horse", autocomplete: "current-password" })}${runButton("Sign in", { type: "button", isFullWidth: true, isBig: true })}`;

component({
  name: "Glass pane",
  slug: "glass-pane",
  group: "panes",
  summary: "A sheet of glass that holds a task: signing in, a game at a glance, a form. Its content scrolls inside it rather than shrinking.",
  styles: PANE_STYLES,
  render: glassPane,
  examples: [
    { label: "Sign-in, medium", markup: glassPane({ paneSize: "medium", body: signInBody("example-pane-medium") }), isWide: true },
  ],
});

const MENU_ITEMS: MenuItem[] = [
  { kind: "link", label: "Your profile", icon: "person", href: "#account-menu" },
  { kind: "link", label: "Friends", icon: "friends", href: "#account-menu" },
  { kind: "link", label: "Developer", icon: "code", href: "#account-menu" },
  { kind: "link", label: "Settings", icon: "gear", href: "#account-menu" },
  { kind: "rule" },
  { kind: "form", label: "Sign out", icon: "sign-out", action: "#account-menu" },
];

component({
  name: "Account menu",
  slug: "account-menu",
  group: "panes",
  summary: "A short list of places that hangs from a button, like the account button in the header.",
  styles: MENU_STYLES,
  render: accountMenu,
  examples: [
    {
      label: "Open, from a button",
      markup: html`<div class="menu-frame">${raw('<button type="button" class="shell cut-btn" aria-controls="example-menu" aria-expanded="true"><span class="face cut-raised" data-cut-line="10">')}<svg class="cut-line" aria-hidden="true"><polygon/></svg><span>Your account</span></span></button>${accountMenu({ id: "example-menu", label: "Your account", who: { name: "emma_r", note: "Online" }, items: MENU_ITEMS, isOpen: true })}</div>`,
    },
  ],
});

component({
  name: "Game cover",
  slug: "game-cover",
  group: "panes",
  summary: "A game in a list: the studio's art, bare, with only what concerns you under it.",
  styles: COVER_STYLES,
  render: gameCover,
  examples: [
    { label: "Played, updated since", markup: html`<div class="cover-sample">${standInCovers(["ashen-crown"])}</div>` },
    { label: "Friends playing", markup: html`<div class="cover-sample">${standInCovers(["neon-drift"])}</div>` },
    { label: "Players now", markup: html`<div class="cover-sample">${standInCovers(["hollow-tide"])}</div>` },
    { label: "In focus", markup: html`<div class="cover-sample">${gameCover({ title: "Verdant", imageUrl: "/design/covers/verdant.webp", href: "#verdant", facts: { playerCount: 96 }, isCurrent: true })}</div>`, isStill: true },
    { label: "On a loop", markup: html`<div class="cover-sample" data-state-loop="cover">${standInCovers(["iron-vigil"])}</div>`, isStill: true },
  ],
});
