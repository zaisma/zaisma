import { SIZED_IMAGE_WIDTHS_PX } from "@zaisma/core";
import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE, EDGE, ago, glassPane, icon, sheetMarkup, tag, tray, type IconName } from "./foundations.ts";
import { glanceFacts, pictureRow, type GlanceFacts } from "./data.ts";
import { cutButton, runButton, textButton } from "./actions.ts";
import { REPORT_REASONS, birthdayField, choiceCards, cutField, longField } from "./inputs.ts";
import { grid, paneParts, row, stack, type ControlMarkup, type LayoutItem } from "./layout.ts";

/*
 * Panes: Zaisma's glass as a sheet that holds things (the sign-in's pane), a menu that hangs
 * from a button, and a game's cover. From the sign-in, header and home drafts.
 */

const control = (markup: ControlMarkup): LayoutItem => ({ kind: "control", markup });

/** A dropdown's choice: a link, a button that posts a form (like Sign out), or a button that asks first in a confirm sheet. */
export interface DropdownChoice {
  label: string;
  href?: string;
  /** Where a button posts, in place of a link. */
  action?: string;
  /**
   * The confirm sheet it opens (its id), in place of a link, for a choice that's hard to take back: Sign out everywhere, Remove friend.
   * It looks like any other choice, never red: only a delete's confirm step is.
   */
  confirmSheetId?: string;
  /** The page you're on, or the choice that's made: it sits on a slab with the orange line, like a switch's. */
  isCurrent?: boolean;
  icon?: IconName;
  /** A small number at its end, like unread replies: a Tag. */
  badgeCount?: number;
  /** Pointed at or focused: the gallery's still copies. */
  state?: "is-pointed" | "is-focused";
}

/** A dropdown's item: a choice, or a rule between groups of them. */
export type DropdownItem = DropdownChoice | { kind: "rule" };

/** One choice in a dropdown: words with an icon, a faint slab under the pointer, the slab with the orange line when it's the current one. */
function dropdownChoice(choice: DropdownChoice): Raw {
  const inside = html`${CUT_LINE}${choice.icon ? icon(choice.icon) : ""}<span>${choice.label}</span>${choice.badgeCount ? tag(choice.badgeCount, "count") : ""}`;
  const shared = html` class="dropdown-choice${choice.state ? ` ${choice.state}` : ""}" role="menuitem" tabindex="-1" data-cut-line="8"${choice.isCurrent ? raw(' aria-current="page"') : ""}`;
  if (choice.action !== undefined) return html`<form class="dropdown-form" method="post" action="${choice.action}"><button type="submit"${shared}>${inside}</button></form>`;
  if (choice.confirmSheetId !== undefined) return html`<button type="button" aria-controls="${choice.confirmSheetId}"${shared}>${inside}</button>`;
  return html`<a href="${choice.href ?? "#"}"${shared}>${inside}</a>`;
}

export interface DropdownOptions {
  /** Its button's aria-controls. */
  id: string;
  /** What it is, for a screen reader: "Your account". */
  label: string;
  /** A head over its places, like the account's name and whether you're online. */
  head?: { title: string; note?: string };
  items: DropdownItem[];
  isOpen?: boolean;
}

/** A dropdown: a pane of the glass that hangs from any button (aria-controls its id), holding a short list of choices. */
export function dropdown(options: DropdownOptions): Raw {
  return html`<div class="dropdown glass${options.isOpen ? "" : " shut"}" id="${options.id}" role="menu" aria-label="${options.label}" aria-hidden="${options.isOpen ? "false" : "true"}" data-glass data-glass-corners="menu">${EDGE}${options.head ? html`<div class="dropdown-head"><strong>${options.head.title}</strong>${options.head.note ? html`<span>${options.head.note}</span>` : ""}</div>` : ""}${options.items.map((menuItem) =>
    "kind" in menuItem ? raw('<hr role="separator">') : dropdownChoice(menuItem),
  )}</div>`;
}

/** The same facts as the glance list, short, under a cover: when you played, an update or friends on the left, players now on the right. */
function coverFacts(facts: GlanceFacts): Raw {
  const nowMs = Date.now();
  const friends = facts.friends ?? [];
  const left =
    facts.playedAtMs !== undefined
      ? html`<span class="when">${icon("clock")}<span><span class="sr">Played </span>${ago(nowMs - facts.playedAtMs)}</span></span>${facts.updatedAtMs !== undefined ? html`${tag("Updated", "new")}` : ""}`
      : friends.length
        ? html`<span class="friends">${pictureRow(friends.map((friend) => friend.username), "xs")}<span>${friends.map((friend) => friend.username).join(", ")}<span class="sr"> playing</span></span></span>`
        : "";
  return html`<div class="cover-meta">${left}${facts.playerCount !== undefined ? html`<span class="count">${icon("people")}<span>${facts.playerCount.toLocaleString("en-US")}<span class="sr"> playing now</span></span></span>` : ""}</div>`;
}

export interface GameCoverOptions {
  title: string;
  /** The studio's cover, or null for a game with none yet: Zaisma's mark in the well stands in, as it does while a cover loads, with the game's title under it. */
  imageUrl: string | null;
  href: string;
  facts: GlanceFacts;
  /** The game in the pane beside the list: its orange line stays drawn. */
  isCurrent?: boolean;
  /** Its art loads with the page, not once it nears the screen: for the covers a page opens with in view, like the home's first. */
  isEager?: boolean;
  /** Its art is fetched before the page's other pictures: for the one cover likely the largest thing in the first view. */
  hasHighPriority?: boolean;
}

/**
 * A game's cover: the studio's art alone, bare. Until it has loaded, and where there's none, Zaisma's mark sits in the well in its place.
 * The orange line draws in under it on point and runs out to the right on leave.
 */
/**
 * A picture Zaisma serves (/img/<id>) at the sizes it keeps of it, for the browser to pick the one it shows (srcset): up to a cover's
 * width at three times its pixels. Any other address (a stand-in cover, a picture elsewhere) is shown as it is.
 */
function coverSizes(imageUrl: string): Raw {
  if (!/^\/img\/[A-Za-z0-9_-]+$/.test(imageUrl)) return raw("");
  const widths = SIZED_IMAGE_WIDTHS_PX.filter((widthPx) => widthPx <= COVER_LARGEST_PX);
  return html` srcset="${widths.map((widthPx) => `${imageUrl}/w${widthPx}.webp ${widthPx}w`).join(", ")}" sizes="(max-width: 760px) 200px, 260px"`;
}
/** The largest width a cover's picture is offered at: a 260px cover at three times its pixels, rounded up to a kept size. */
const COVER_LARGEST_PX = 960;

export function gameCover(options: GameCoverOptions): Raw {
  const isUpdated = options.facts.updatedAtMs !== undefined && options.facts.playedAtMs !== undefined;
  const isPlaceholder = options.imageUrl === null;
  return html`<div class="cover${isPlaceholder ? " is-placeholder" : ""}"${options.isCurrent ? raw(' aria-current="true"') : ""}><a class="cover-art" data-cut-line="0" href="${options.href}" aria-label="${options.title}${isUpdated ? ", updated" : ""}">${options.imageUrl === null ? html`<span class="cover-title" aria-hidden="true">${options.title}</span>` : html`<img src="${options.imageUrl}"${coverSizes(options.imageUrl)} alt="" loading="${options.isEager ? "eager" : "lazy"}"${options.hasHighPriority ? raw(' fetchpriority="high"') : ""} decoding="async">`}</a><span class="cover-bar" aria-hidden="true"></span>${coverFacts(options.facts)}</div>`;
}

/**
 * Menus: a button with aria-controls and aria-expanded opens the menu it names. It hangs just under the header slab when the button is in
 * the header, otherwise just under the button: from the button's end, or from its start where that would run off the screen's start, and
 * kept on the screen either way. Escape, a press elsewhere or choosing an item closes it; the arrow keys move through it.
 */
export const DROPDOWN_SCRIPT = `/* menus */(function () {
  var root = getComputedStyle(document.documentElement);
  // The gap under the button, and the least room kept from the screen's edges: two controls stacked, and the frame gap.
  function token(name, fallback) { return parseFloat(root.getPropertyValue(name)) || fallback; }
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
    var gapPx = token("--gap-control-stack", 8), edgePx = token("--pad-frame", 10);
    var origin = fixedOrigin(menu), r = button.getBoundingClientRect(), slab = button.closest(".top"), below = slab ? slab.getBoundingClientRect().bottom : r.bottom;
    // The room it keeps to: the screen, or what holds it where that holds fixed things (a gallery frame stands in for a screen).
    var start = origin.width ? origin.left : 0, end = origin.width ? origin.right : document.documentElement.clientWidth;
    var width = menu.offsetWidth, isFromStart = r.right - width < start + edgePx, left = isFromStart ? r.left : r.right - width;
    left = Math.max(start + edgePx, Math.min(end - edgePx - width, left));
    menu.classList.toggle("from-start", isFromStart);
    menu.style.top = (below - origin.top + gapPx) + "px";
    menu.style.left = (left - origin.left) + "px";
  }
  function toggle(menu, open, focusFirst) {
    var button = buttonOf(menu);
    if (button) button.setAttribute("aria-expanded", String(open));
    menu.classList.toggle("shut", !open); menu.setAttribute("aria-hidden", String(!open));
    if (open) { place(menu); if (focusFirst && items(menu)[0]) items(menu)[0].focus({ preventScroll: true }); }
  }
  // Every menu on the page, and any added later: one gone from the page is let go.
  var menus = [];
  function shown() { menus = menus.filter(function (menu) { return menu.isConnected; }); return menus; }
  window.zaismaWatch.each('.dropdown[role="menu"]', function (menu) {
    menus.push(menu);
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
    if (!menu || !menu.matches('.dropdown[role="menu"]')) return;
    toggle(menu, button.getAttribute("aria-expanded") !== "true", event.detail === 0);
  });
  document.addEventListener("pointerdown", function (event) {
    shown().forEach(function (menu) { var button = buttonOf(menu); if (!menu.classList.contains("shut") && !menu.contains(event.target) && !(button && button.contains(event.target))) toggle(menu, false); });
  });
  function placeAll() { shown().forEach(place); }
  window.zaismaWatch.resize(placeAll);
  window.zaismaWatch.scroll(placeAll);
})();
`;

const DROPDOWN_STYLES = `
/* A dropdown: a pane of the glass hanging just under its button, as wide as what's in it (never wider than the screen), holding a short
   list of choices. It grows from the button's end, or from its start when it hangs from there (from-start). */
.dropdown { position: fixed; z-index: 11; width: max-content; max-width: calc(100vw - 2 * var(--pad-frame)); padding: var(--pad-inner-pane); --pad-words: var(--pad-inside-words); --glass-tint: var(--glass-dropdown);
  display: flex; flex-direction: column; gap: 2px;
  transform-origin: top right; transition: var(--glass-transition), opacity 0.25s, transform 0.35s cubic-bezier(.2,.8,.2,1); }
.dropdown.from-start { transform-origin: top left; }
.dropdown.shut { opacity: 0; transform: translateY(-6px) scale(0.98); pointer-events: none; visibility: hidden; transition: var(--glass-transition), opacity 0.25s, transform 0.35s cubic-bezier(.2,.8,.2,1), visibility 0s 0.35s; }
/* Its own words (its head's) keep its margin, --pad-words in from its padding: as far in as the choices' words, which sit that far into
   each choice. The head's rule is as long as the rules between the choices. */
.dropdown-head { display: flex; flex-direction: column; padding: var(--pad-words) var(--pad-words) var(--gap-words-control); margin-bottom: var(--gap-control-stack); border-bottom: var(--divider); }
.dropdown-head strong { font: var(--type-name); color: var(--ink); overflow-wrap: anywhere; text-wrap: balance; }
.dropdown-head span { color: var(--muted); font: var(--type-facts); }
.dropdown hr { border: 0; border-top: var(--divider); margin: var(--gap-control-stack) 0; }
/* A choice: words on the glass, a small control's height (a regular one's on a touch screen); under the pointer a faint slab, cut by the
   edge rule; the current one on the switch's slab with its orange line. Its words sit as far in as a field's. */
.dropdown-form { margin: 0; }
.dropdown-choice { --control-height: var(--control-height-small); position: relative; display: flex; align-items: center; gap: var(--gap-words-words); width: 100%; height: var(--control-height); padding: 0 var(--pad-inside-words); margin: 0; border: 0; cursor: pointer;
  font: var(--type-words); color: var(--ink-2); text-align: left; text-decoration: none; white-space: nowrap;
  --face-color: transparent; background: var(--face-color); clip-path: var(--cut-shape); transition: --face-color 0.15s, color 0.15s; }
@media (pointer: coarse) { .dropdown-choice { --control-height: var(--control-height-regular); } }
.dropdown-choice > :not(.cut-line) { position: relative; z-index: 2; }
.dropdown-choice > span:not(.tag) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dropdown-choice > .tag { margin-left: auto; }
/* Pointed at, a choice takes a wash of the words' own color: darker on light glass, lighter on smoked, so it shows on either. */
.dropdown-choice:hover, .dropdown-choice.is-pointed, .dropdown-choice:focus-visible, .dropdown-choice.is-focused { --face-color: var(--wash); color: var(--ink); }
.dropdown-choice[aria-current="page"] { color: var(--ink); background: var(--slab); box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run); }
.dropdown-choice:focus-visible { outline: none; }
.dropdown-choice:focus-visible > .cut-line polygon, .dropdown-choice.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
@media (prefers-reduced-motion: reduce) { .dropdown { transition: var(--glass-transition); } }
`;

const PANE_STYLES = `
/* The pane: Zaisma's glass, the same as the home's and the header's. No sheen. Full is the whole width; fit is as wide as what's in it,
   with its paragraphs running to a reading width at most, so words set it the way a line of text would. */
.glass-pane { display: flex; flex-direction: column; max-width: 100%; }
.glass-pane.full { width: 100%; }
.glass-pane.fit { width: fit-content; }
.glass-pane.fit > .pane-in :where(p) { max-width: var(--size-reading); }
.glass-pane { position: relative; }
/* Long content scrolls inside it, on Zaisma's own rail (RAIL_SCRIPT gives any box that scrolls one). It pads at the frame gap: what has an
   edge of its own sits there, and its words keep the pane's margin, --pad-words further in (layout.ts places them). */
.glass-pane > .pane-in { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--gap-block-block); padding: var(--pad-frame);
  --pad-words: calc(var(--pad-pane) - var(--pad-frame)); }
/* With its rail showing, the pane keeps room for it along its right edge, so the rail never sits against what's in it; while nothing
   scrolls the rail is hidden and the pane keeps the frame gap, so what sits in its corner still takes the corner's cut. */
.glass-pane > .pane-in.own-scroll.shows-rail { padding-right: calc(var(--pad-frame) + 16px); }
/* Nothing in the pane shrinks when its content is long: it scrolls instead. */
.glass-pane > .pane-in > * { flex-shrink: 0; }
/* A form in a pane stacks what it holds as the pane does, and so does any group of blocks in it (pane-stack: a step that shows or hides). */
.glass-pane > .pane-in form, .glass-pane .pane-stack { display: flex; flex-direction: column; gap: var(--gap-block-block); }
/* Something empty in it (a bot check before its widget arrives) takes no room and no gap round it. A bot check's widget is 0px tall until
   it needs you (Turnstile's interaction-only), so it gives back half a gap on each side: unseen, it takes no gap; shown, half a gap round it. */
:where(.glass-pane > .pane-in, .glass-pane form, .pane-stack, .sheet-in, .sheet-body) > :empty:not(input, textarea, select, img, canvas, iframe, video, svg, hr) { display: none; }
:where(.glass-pane > .pane-in, .glass-pane form, .pane-stack, .sheet-in, .sheet-body) > [data-bot-check] { margin-block: calc(-1 * var(--gap-block-block) / 2); }
/* A page's own heading (h1) when the pane is the page, or one of a few on it (h2). */
.glass-pane :is(h1, h2) { margin: 0; font: var(--type-heading); text-wrap: balance; }
/* Its own words only: zero specificity, so any component's words (a field's error and hint) keep their own color. */
:where(.glass-pane) p { margin: 0; color: var(--ink-2); }
/* Headings and paragraphs in a pane, a tray or a sheet keep its margin at its sides wherever they sit (layout.ts's edge rules give its top
   and bottom); inside anything with an edge of its own there's none (a slab of glass sets --pad-words to nothing), and any component's
   own padding wins over this. */
:where(.glass-pane > .pane-in, .tray, .sheet-in) :where(h1, h2, h3, h4, p) { padding-inline: var(--pad-words); }
`;

const COVER_STYLES = `
/* Covers are the studios' art alone: no rim, no glass, nothing drawn on them. They're cut by the edge rule like every control, so a
   cover near a pane's corner takes the pane's cut and one in the middle of it is square: never a rectangle against a cut corner.
   Under the art, Zaisma's mark sits in the well: it shows until the art has loaded, and stays where a game has none (is-placeholder). */
.cover { position: relative; min-width: 0; }
.cover-art { position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; clip-path: var(--cut-shape); text-decoration: none;
  background: url("/zaisma-mark-metal.svg") center / auto 50% no-repeat var(--well); }
.cover-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.cover.is-placeholder .cover-art img { display: none; }
/* A game with no cover has its title under the mark, so it's never a blank in a list. */
.cover.is-placeholder .cover-art { display: flex; align-items: flex-end; justify-content: center; background-position: center 38%; }
.cover-title { position: relative; z-index: 2; max-width: 100%; padding: var(--pad-frame); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--type-name); color: var(--ink-2); }
.cover-art:focus-visible { outline: none; }
.cover-art:focus-visible > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
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
/* Where they can't share a line, players now goes on to the next, never cut short. */
.cover-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-words-words); min-height: 24px; margin-top: var(--gap-words-words); font: var(--type-facts); color: var(--muted); }
.cover-meta .ico { width: 15px; height: 15px; stroke-width: 1.5; }
.cover-meta .when, .cover-meta .count, .cover-meta .friends { display: inline-flex; align-items: center; gap: var(--gap-words-words); min-width: 0; }
.cover-meta .when, .cover-meta .count { white-space: nowrap; }
.cover-meta .friends { color: var(--ink); font-weight: 600; }
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
  summary: "A sheet of glass that holds a task: signing in, a game at a glance, a form. It's as wide as what holds it, or as wide as what's in it, its paragraphs running to a reading width at most; never a width of its own. Its content scrolls inside it rather than shrinking.",
  styles: PANE_STYLES,
  render: glassPane,
  examples: [
    { label: "Fit: as wide as what's in it", markup: glassPane({ paneWidth: "fit", body: signInBody("example-pane-fit") }), isWide: true },
    { label: "Full: as wide as what holds it (one that should take half the screen goes in Columns)", markup: glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "words", markup: html`<h2>Rooms</h2>` }, { kind: "words", markup: html`<p>267 playing now in 78 rooms.</p>` }] }) }), isWide: true },
  ],
});

const ACCOUNT_ITEMS: DropdownItem[] = [
  { label: "Your profile", icon: "person", href: "#dropdown" },
  { label: "Friends", icon: "friends", href: "#dropdown" },
  { label: "Developer", icon: "code", href: "#dropdown" },
  { label: "Settings", icon: "gear", href: "#dropdown" },
  { kind: "rule" },
  { label: "Sign out", icon: "sign-out", action: "#dropdown" },
];
/** An example menu hanging from its button, open: the button at the frame's end, or at its start. */
const dropdownFrame = (buttonLabel: string, options: DropdownOptions, buttonPlace: "end" | "start" = "end") => {
  const button = cutButton(buttonLabel, { type: "button", controls: options.id, isExpanded: true });
  return html`<div class="dropdown-frame">${buttonPlace === "end" ? button : html`<span style="position: absolute; left: var(--pad-pane); top: 0">${button}</span>`}${dropdown({ ...options, isOpen: true })}</div>`;
};

component({
  name: "Tray",
  slug: "tray",
  group: "panes",
  summary: "A thinner, clearer sheet a pane extends into, holding everything that belongs to it: the pane's words on top, what they're about on the tray beneath, read as one. Every gallery section is one.",
  styles: `
/* A tray: the pane above holds the words, square along its foot; the tray runs on from it with no rim of its own along the top. It's
   the same glass, light or smoked, only thinner and muted, so the pane stands out and the tray stays in the background: a clearer
   tint (--glass-tray), a fainter sheen (--glass-tray-sheen), less blur, the colors behind it less lifted, and a fainter rim, its bevel as wide.
   Like a pane, it's as wide as what holds it (full) or as wide as what's in it (fit). */
.tray-group { display: flex; flex-direction: column; }
.tray-group.full { width: 100%; }
.tray-group.fit { width: fit-content; max-width: 100%; }
.tray-head { padding: var(--pad-pane); }
/* Thinner glass, closer words: what has an edge sits at the frame gap, like a pane's, and its words keep the tray's margin, --pad-tray, closer than a pane's. */
.tray { --glass-tint: var(--glass-tray); --glass-sheen: var(--glass-tray-sheen); --glass-blur: 12px; --glass-saturate: 1.15; padding: var(--pad-frame); --pad-words: calc(var(--pad-tray) - var(--pad-frame)); }
.tray > .edge { opacity: 0.45; }
.tray-sample-title { margin: 0; font: var(--type-section); }
`,
  render: tray,
  examples: [
    {
      label: "Fit: a head, and what it's about on the tray",
      isWide: true,
      markup: tray({ paneWidth: "fit", head: html`<h3 class="tray-sample-title">Your games</h3>`, body: row({ widths: "lead-fills", items: [control(runButton("Play", { type: "button", icon: "play" })), control(cutButton("Details", { type: "button" }))] }) }),
    },
    {
      label: "Full: holding a row of covers",
      isWide: true,
      markup: tray({ paneWidth: "full", head: html`<h3 class="tray-sample-title">Continue playing</h3>`, body: grid({ itemSize: "cover", items: ["ashen-crown", "neon-drift", "hollow-tide"].map((slug) => ({ kind: "block", markup: STAND_IN_COVERS[slug]! })) }) }),
    },
  ],
});

const REMOVE_FRIEND = { id: "example-menu-remove-friend", title: "Remove Liam as a friend?", text: "You leave each other's friends, and neither of you sees when the other is online. Either of you can ask again later.", action: "#dropdown", confirmLabel: "Remove friend" } as const;

component({
  name: "Dropdown",
  slug: "dropdown",
  group: "panes",
  summary: "A short list of choices that hangs from a button, like the account button's in the header: with a head, rules, icons, counts and the current one, as each needs. A choice that's hard to take back asks first, in a confirm sheet.",
  styles: DROPDOWN_STYLES,
  render: dropdown,
  examples: [
    { label: "Your account, from its button", markup: dropdownFrame("Your account", { id: "example-menu-account", label: "Your account", head: { title: "emma_r", note: "Online" }, items: ACCOUNT_ITEMS }) },
    {
      label: "Choosing one, the current marked",
      markup: dropdownFrame("Sort", { id: "example-menu-sort", label: "Sort games", items: [{ label: "Most played", href: "#dropdown", isCurrent: true }, { label: "Newest", href: "#dropdown" }, { label: "Recently updated", href: "#dropdown" }] }),
    },
    {
      label: "With counts",
      markup: dropdownFrame("Inbox", { id: "example-menu-inbox", label: "Inbox", head: { title: "Inbox" }, items: [{ label: "Replies", icon: "mail", href: "#dropdown", badgeCount: 3 }, { label: "Mentions", icon: "person", href: "#dropdown", badgeCount: 12 }, { kind: "rule" }, { label: "Settings", icon: "gear", href: "#dropdown" }] }),
    },
    {
      label: "Pointed at, and focused",
      isStill: true,
      markup: dropdownFrame("Sort", { id: "example-menu-states", label: "Sort games", items: [{ label: "Most played", href: "#dropdown", isCurrent: true }, { label: "Newest", href: "#dropdown", state: "is-pointed" }, { label: "Recently updated", href: "#dropdown", state: "is-focused" }] }),
    },
    {
      label: "A long username",
      markup: dropdownFrame("Your account", { id: "example-menu-long", label: "Your account", head: { title: "alexandra_whitmore_7", note: "Playing Ashen Crown" }, items: ACCOUNT_ITEMS }),
    },
    {
      label: "A choice that asks first",
      markup: html`${dropdownFrame("Liam", { id: "example-menu-friend", label: "Liam", head: { title: "Liam", note: "Friends since March" }, items: [{ label: "Profile", icon: "person", href: "#dropdown" }, { label: "Invite to a game", icon: "gamepad", href: "#dropdown" }, { kind: "rule" }, { label: "Remove friend", icon: "ban", confirmSheetId: REMOVE_FRIEND.id }] })}${confirmSheet(REMOVE_FRIEND)}`,
    },
    {
      label: "From a button at the screen's start",
      markup: dropdownFrame("Sort", { id: "example-menu-start", label: "Sort games", items: [{ label: "Most played", href: "#dropdown", isCurrent: true }, { label: "Newest", href: "#dropdown" }, { label: "Recently updated", href: "#dropdown" }] }, "start"),
    },
  ],
});

component({
  name: "Game cover",
  slug: "game-cover",
  group: "panes",
  summary: "A game in a list: the studio's art, bare, with only what concerns you under it. Zaisma's mark stands in while the art loads, and for a game with none yet.",
  styles: COVER_STYLES,
  render: gameCover,
  examples: [
    { label: "Played, updated since", markup: html`<div class="cover-sample">${standInCovers(["ashen-crown"])}</div>` },
    { label: "Friends playing", markup: html`<div class="cover-sample">${standInCovers(["neon-drift"])}</div>` },
    { label: "Players now", markup: html`<div class="cover-sample">${standInCovers(["hollow-tide"])}</div>` },
    { label: "In focus", markup: html`<div class="cover-sample">${gameCover({ title: "Verdant", imageUrl: "/design/covers/verdant.webp", href: "#verdant", facts: { playerCount: 96 }, isCurrent: true })}</div>`, isStill: true },
    { label: "On a loop", markup: html`<div class="cover-sample" data-state-loop="cover">${standInCovers(["iron-vigil"])}</div>`, isStill: true },
    { label: "No cover yet", markup: html`<div class="cover-sample">${gameCover({ title: "The Last Lighthouse Keeper", imageUrl: null, href: "#game-cover", facts: { playerCount: 38 } })}</div>` },
    {
      label: "Five friends playing",
      markup: html`<div class="cover-sample">${gameCover({ title: "Kestrel", imageUrl: "/design/covers/kestrel.webp", href: "#kestrel", facts: { playerCount: 12480, friends: [{ username: "Sofia" }, { username: "Liam" }, { username: "Emma" }, { username: "Noah" }, { username: "Charlotte" }] } })}</div>`,
    },
  ],
});

export interface SheetOptions {
  /** Unique on the page: the button that opens it names it (cutButton's controls). */
  id: string;
  title: string;
  /** Its words and fields, which scroll between its head and its buttons when they're long. The sheet is one form: it holds none of its own. */
  body: Raw;
  /** What its close button says to a screen reader: "Close". */
  closeLabel: string;
  /** Its buttons, at its foot and in view while the body scrolls: the way out first, the one thing to do last (Cancel, Send report). */
  buttons?: ControlMarkup[];
  /** Where its form posts when a button sends it. Without one, a button that sends it only closes it. */
  action?: string;
  /**
   * Where it sits: "center" over the dimmed page (report a game, add a key); "foot" risen from the screen's foot over a running game, which
   * stays in view and isn't dimmed (a buy sheet). On a phone both rise from the foot.
   */
  placement?: "center" | "foot";
  /** Open in place rather than over the page: the gallery's still copy. */
  isShown?: boolean;
}

/**
 * A sheet: a pane of glass over the page for a task that comes and goes (report a game, block someone), opened by a button that names it.
 * Its head (the title, and Close in the corner) and its buttons stay where they are while what's between them scrolls. It's one form, so
 * Close and Cancel close it without sending it (formmethod="dialog").
 */
export function sheet(options: SheetOptions): Raw {
  return sheetMarkup({ ...options, closeButton: cutButton(options.closeLabel, { type: "submit", formMethod: "dialog", icon: "close", isLabelHidden: true, isSmall: true }) });
}

export interface ConfirmSheetOptions {
  id: string;
  /** The question: "Sign out everywhere?" */
  title: string;
  /** One sentence on what happens. */
  text: string;
  /** Where its action posts. */
  action: string;
  /** The action's words: "Sign out everywhere". */
  confirmLabel: string;
  /** Its action sent and waiting, the loader in its arrow's place: the gallery's still copy (BUSY_SCRIPT does it on a page). */
  isBusy?: boolean;
  isShown?: boolean;
}

/** A confirm sheet: one sentence, the action and Cancel, before something that's hard to take back. A delete's is Delete button's own, the only red one. */
export function confirmSheet(options: ConfirmSheetOptions): Raw {
  return sheet({
    id: options.id,
    title: options.title,
    body: html`<p class="sheet-text">${options.text}</p>`,
    closeLabel: "Close",
    action: options.action,
    buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog", isAutofocused: !options.isBusy }), runButton(options.confirmLabel, { type: "submit", isBusy: options.isBusy })],
    isShown: options.isShown,
  });
}

/** Sheets: a button that names one (aria-controls, with no aria-expanded: that's a dropdown) opens it over the page; a press beside it closes it. Esc and its own buttons close it natively. */
export const SHEET_SCRIPT = `/* sheets */(function () {
  document.addEventListener("click", function (event) {
    var opener = event.target.closest && event.target.closest("[aria-controls]:not([aria-expanded])");
    var named = opener && document.getElementById(opener.getAttribute("aria-controls"));
    if (named && named.matches("dialog.sheet")) { event.preventDefault(); if (!named.open) named.showModal(); return; }
    var open = event.target.matches && event.target.matches("dialog.sheet[open]") ? event.target : null;
    if (!open || !event.detail) return;
    var r = open.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) open.close();
  });
})();
`;

/** On a touch screen, a button shorter than a regular control reaches past its own box to a regular control's height, unseen: for `scope`'s buttons. */
const touchReach = (scope: string) => `@media (pointer: coarse) {
  ${scope} .shell::after { content: ""; position: absolute; left: 0; right: 0; top: min(0px, calc((100% - var(--control-height-regular)) / 2)); bottom: min(0px, calc((100% - var(--control-height-regular)) / 2)); }
}`;

const SHEET_STYLES = `
/* A sheet: a dialog of the panes' glass over the page, which dims behind it (dimmed, not blurred, so it stays cheap). It comes up a
   little as it opens and drops away as it closes, the dimming fading with it; nothing in it waits for that. Centered on a wide screen; on
   a phone it rises from the foot of the screen, a gap from its edges. Like a pane that fits, it's as wide as what's in it, its words running
   to a reading width at most. */
.sheet { width: fit-content; max-width: calc(100% - 2 * var(--pad-pane)); max-height: calc(100dvh - 2 * var(--pad-pane)); margin: auto; padding: 0; border: 0; overflow: visible; color: var(--ink);
  --glass-tint: var(--glass-dropdown);
  transition: var(--glass-transition), opacity 0.25s, transform 0.3s cubic-bezier(.2,.8,.2,1), overlay 0.3s allow-discrete, display 0.3s allow-discrete; }
/* Over the page, fixed to the window whether it's opening, open or closing (it stops being :modal the moment it starts to close). */
.sheet:not(.in-place) { position: fixed; inset: 0; z-index: 40; }
.sheet:not([open]) { opacity: 0; transform: translateY(16px) scale(0.98); transition-timing-function: ease, ease, cubic-bezier(.4,0,1,1); }
@starting-style { .sheet[open] { opacity: 0; transform: translateY(12px) scale(0.985); } }
.sheet::backdrop { background: rgba(6, 9, 14, 0.42); opacity: 1; transition: opacity 0.3s, overlay 0.3s allow-discrete, display 0.3s allow-discrete; }
.sheet:not([open])::backdrop { opacity: 0; }
@starting-style { .sheet[open]::backdrop { opacity: 0; } }
/* At the foot: risen from the bottom of the screen over a running game, which stays in view, never dimmed (a buy sheet). */
.sheet.placement-foot:not(.in-place) { margin: auto auto var(--pad-pane); }
.sheet.placement-foot:not([open]) { transform: translateY(40px); }
@starting-style { .sheet.placement-foot[open] { transform: translateY(40px); } }
.sheet.placement-foot::backdrop { background: transparent; }
/* In place (the gallery's still copy): a pane where it sits, in the page's flow, so it shows whole: there's no window to fit. */
.sheet.in-place { position: relative; z-index: auto; margin: 0; max-height: none; }
/* A sheet is a pane: it pads at the frame gap and its words keep the pane's margin (--pad-words). It's one form, its head (the title, and
   Close in the top end corner, taking the corner's cut, Pane parts' head), its body and its buttons at its foot. Only the body scrolls, so
   the head and the buttons stay in view, and Close keeps its corner. */
.sheet-in { display: flex; flex-direction: column; gap: var(--gap-block-block); max-height: inherit; min-height: 0; overflow-y: auto; margin: 0; padding: var(--pad-frame); --pad-words: calc(var(--pad-pane) - var(--pad-frame)); }
.sheet-in :where(p, .sheet-text) { max-width: var(--size-reading); }
.sheet-in > .pane-parts, .sheet-in > .pane-parts > .pane-body { flex: 1 1 auto; min-height: 0; }
.sheet-title { margin: 0; font: var(--type-section); color: var(--ink); text-wrap: balance; }
/* The body scrolls across the sheet's whole width, so its rail sits where a pane's does, and what's in it keeps the frame gap. */
.sheet-scroll { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; margin-inline: calc(-1 * var(--pad-frame)); }
.sheet-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--gap-block-block); padding-inline: var(--pad-frame); }
/* With its rail showing, the body keeps room for it along its right edge. */
.sheet-body.own-scroll.shows-rail { padding-right: calc(var(--pad-frame) + 14px); }
/* With no buttons under it, the body's last words are at the sheet's foot and keep its margin there. */
.pane-parts:not(:has(> .pane-foot)) > .pane-body > .sheet-scroll > .sheet-body > :is(p, h3, .stack-cell.is-words):last-child { padding-bottom: var(--pad-words); }
.sheet-text { margin: 0; padding-inline: var(--pad-words); font: var(--type-words); color: var(--ink-2); }
/* A sheet made by sheetMarkup (foundations.ts: a delete's confirm step): its head and words in one box that scrolls. */
.sheet-in.own-scroll.shows-rail { padding-right: calc(var(--pad-frame) + 14px); }
${touchReach(".sheet")}
@media (max-width: 760px) {
  /* On a phone it rises from the foot of the screen and stops well short of the top, so the page stays in view above it. */
  .sheet:not(.in-place) { width: calc(100% - 2 * var(--gap-control-stack)); max-height: 78dvh; margin: auto var(--gap-control-stack) var(--gap-control-stack); }
  .sheet:not(.in-place):not([open]) { transform: translateY(40px); }
  @starting-style { .sheet:not(.in-place)[open] { transform: translateY(40px); } }
}
@media (prefers-reduced-motion: reduce) { .sheet { transition: var(--glass-transition), opacity 0.2s, overlay 0.2s allow-discrete, display 0.2s allow-discrete; } .sheet:not([open]) { transform: none; } }
`;

const reportBody = (idPrefix: string) =>
  html`${choiceCards({ id: `${idPrefix}-reason`, name: `report_reason_${idPrefix}`, label: "What's wrong", choices: REPORT_REASONS, pickedValue: "broken", isCompact: true })}${longField({ id: `${idPrefix}-details`, name: "report_text", label: "What you saw", rowCount: 3, maximumCharacterCount: 2000 })}`;
const reportSheet = (id: string, options: { title?: string; isShown?: boolean } = {}) =>
  sheet({ id, title: options.title ?? "Report Ashen Crown", body: reportBody(id), closeLabel: "Close", action: "#sheet", buttons: [runButton("Send report", { type: "submit" })], isShown: options.isShown });

component({
  name: "Sheet",
  slug: "sheet",
  group: "panes",
  summary: "A task that comes and goes over the page: report a game, block someone, add a key. Opened by a button that names it; Esc, its close button or a press beside it close it. Its title, Close and its buttons stay in view while the rest scrolls.",
  styles: SHEET_STYLES,
  render: sheet,
  examples: [
    { label: "Try it: from its button (on a short screen its title and Send report stay while the reasons scroll)", markup: html`${cutButton("Report this game", { type: "button", controls: "example-sheet-try" })}${reportSheet("example-sheet-try")}` },
    { label: "Open", markup: reportSheet("example-sheet-shown", { isShown: true }), isWide: true, isStill: true },
    {
      label: "A long title",
      isStill: true,
      markup: sheet({ id: "example-sheet-long", title: "Report The Last Lighthouse Keeper: Tides of the Northern Reach", body: longField({ id: "example-sheet-long-details", name: "report_text", label: "What you saw", rowCount: 3, maximumCharacterCount: 2000 }), closeLabel: "Close", action: "#sheet", buttons: [runButton("Send report", { type: "submit" })], isShown: true }),
    },
    {
      label: "Try it: at the foot, over a running game, which stays in view (a buy sheet)",
      markup: html`${cutButton("Buy the Founder's Pack", { type: "button", controls: "example-sheet-foot" })}${sheet({ id: "example-sheet-foot", title: "Founder's Pack", body: html`<p>The soundtrack, the Ember Keep castle and 1,200 crowns in Ashen Crown, on every device you sign in on.</p>`, closeLabel: "Close", action: "#sheet", placement: "foot", buttons: [cutButton("Not now", { type: "submit", formMethod: "dialog" }), runButton("Buy for $14.99", { type: "submit" })] })}`,
    },
  ],
});

const SIGN_OUT_EVERYWHERE = { title: "Sign out everywhere?", text: "Every device signed in as you is signed out, this one too. Games keep your saves.", action: "#confirm-sheet", confirmLabel: "Sign out everywhere" } as const;

component({
  name: "Confirm sheet",
  slug: "confirm-sheet",
  group: "panes",
  summary: "One sentence, the action and Cancel, before something that's hard to take back: signing out everywhere, ending a room. A delete's confirm is Delete button's own, the only red one.",
  styles: "",
  render: confirmSheet,
  examples: [
    { label: "Try it: from its button", markup: html`${cutButton("Sign out everywhere", { type: "button", controls: "example-confirm-try" })}${confirmSheet({ id: "example-confirm-try", ...SIGN_OUT_EVERYWHERE })}` },
    { label: "Open", markup: confirmSheet({ id: "example-confirm-shown", ...SIGN_OUT_EVERYWHERE, isShown: true }), isWide: true, isStill: true },
    { label: "Sent, waiting", markup: confirmSheet({ id: "example-confirm-busy", title: "End this room?", text: "The 6 players in North gate go back to the menu, and the room's world is kept for 30 days.", action: "#confirm-sheet", confirmLabel: "End the room", isBusy: true, isShown: true }), isStill: true, isWide: true },
  ],
});

export interface NoticeOptions {
  text: string;
  /** "done": something just went through (Saved), and it leaves by itself after 4 s. "problem": something didn't, and it stays until it's closed. */
  tone: "done" | "problem";
  /** Where its Undo posts, for something done that can be taken back (Removed from your games): it shows Undo, and stays 8 s rather than 4. */
  undoAction?: string;
  /** Where it sits rather than floating under the header: the gallery's still copies. */
  isInPlace?: boolean;
}

/** A notice: a moment that just happened ("Saved", "Couldn't save: you're offline"), in the header's glass just under the header. */
export function notice(options: NoticeOptions): Raw {
  const isProblem = options.tone === "problem";
  const undo = options.undoAction === undefined ? "" : html`<form class="notice-undo" method="post" action="${options.undoAction}">${textButton("Undo", { type: "submit" })}</form>`;
  return html`<div class="notice glass ${options.tone}${options.isInPlace ? " in-place" : ""}" role="${isProblem ? "alert" : "status"}" data-notice="${options.tone}"${undo ? raw(" data-notice-undo") : ""} data-glass data-glass-corners="menu">${EDGE}${icon(isProblem ? "warning" : "check")}<span class="notice-text">${options.text}</span>${undo}${isProblem ? cutButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true }) : ""}</div>`;
}

/**
 * Notices: one that's done leaves after 4 s, or 8 s with Undo (it waits while you point at it); a problem leaves when its close button is
 * pressed. Floating ones stack under the header, newest last, a stacked gap apart, and close up as one leaves. Notices a page adds later
 * are watched too.
 */
export const NOTICE_SCRIPT = `/* notices */(function () {
  var STAY_MS = 4000, UNDO_STAY_MS = 8000, LEAVE_MS = 300;
  var GAP_PX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap-control-stack")) || 8;
  // Each floating notice sits under the ones before it.
  function stack() {
    var shift = 0;
    document.querySelectorAll("[data-notice]:not(.in-place)").forEach(function (el) {
      el.style.setProperty("--notice-shift", shift + "px");
      if (!el.classList.contains("is-leaving")) shift += el.offsetHeight + GAP_PX;
    });
  }
  // One in place (the gallery's still copy) comes back a moment after it leaves, so it can be tried again.
  function leave(el) {
    if (el.classList.contains("is-leaving")) return; el.classList.add("is-leaving");
    if (el.classList.contains("in-place")) setTimeout(function () { el.classList.remove("is-leaving"); }, 1600); else setTimeout(function () { el.remove(); stack(); }, LEAVE_MS);
  }
  function wait(el) { clearTimeout(el.noticeTimer); el.noticeTimer = setTimeout(function () { leave(el); }, el.hasAttribute("data-notice-undo") ? UNDO_STAY_MS : STAY_MS); }
  function arrive(el) {
    if (el.noticeArrived || el.classList.contains("in-place")) return; el.noticeArrived = true;
    stack();
    if (el.getAttribute("data-notice") !== "done") return;
    wait(el);
    el.addEventListener("pointerenter", function () { clearTimeout(el.noticeTimer); });
    el.addEventListener("pointerleave", function () { wait(el); });
  }
  function find(root) { if (!root.querySelectorAll) return; if (root.matches("[data-notice]")) arrive(root); root.querySelectorAll("[data-notice]").forEach(arrive); }
  find(document.body);
  window.zaismaWatch.page(function (changes) { changes.forEach(function (change) { change.addedNodes.forEach(find); }); });
  document.addEventListener("click", function (event) { var close = event.target.closest && event.target.closest("[data-notice] > .cut-btn"); if (close) leave(close.closest("[data-notice]")); });
})();
`;

component({
  name: "Notice",
  slug: "notice",
  group: "panes",
  summary: "A moment that just happened, just under the header: Saved, Copied, or what went wrong. A done one leaves by itself after 4 seconds (8 with Undo); a problem stays until it's closed. Two at once stack.",
  styles: `
/* A notice: a small slab of the header's glass floating just under the header, in the middle, under any notices before it. It comes down a
   little as it arrives and fades up as it leaves. A done one carries a green tick, a problem the warning in the marked color and a close
   button. Its height is a small control's and the room round it, so a notice with Close or Undo is as tall as one without. */
.notice { position: fixed; z-index: 30; top: calc(var(--under-header, 96px) + var(--notice-shift, 0px)); left: 0; right: 0; width: max-content; max-width: calc(100% - 2 * var(--pad-pane)); margin: 0 auto;
  display: flex; align-items: center; gap: var(--gap-words-words); min-height: calc(var(--control-height-small) + 2 * var(--pad-inner-pane)); padding: var(--pad-inner-pane) var(--pad-tray); --glass-tint: var(--glass-top);
  font: var(--type-words); color: var(--ink);
  transition: var(--glass-transition), opacity 0.3s, transform 0.3s cubic-bezier(.2,.8,.2,1), top 0.3s cubic-bezier(.2,.8,.2,1); }
@starting-style { .notice { opacity: 0; transform: translateY(-8px); } }
.notice.is-leaving { opacity: 0; transform: translateY(-8px); }
.notice.in-place { position: relative; top: auto; left: auto; right: auto; z-index: auto; margin: 0; }
.notice > .ico { width: 20px; height: 20px; }
.notice.done > .ico { color: var(--online); stroke-width: 2.4; }
.notice.problem > .ico { color: var(--marked); }
/* A control at its end (Close, Undo) sits at the inner pane's gap from its end, as at its top and foot, and takes its corners' cut. */
.notice:is(.problem, :has(> .notice-undo)) { padding-right: var(--pad-inner-pane); }
.notice-text { min-width: 0; }
.notice-undo { display: flex; }
/* Two or more in place, one under another, as floating ones stack. */
.notice-stack { display: flex; flex-direction: column; align-items: flex-start; gap: var(--gap-control-stack); }
${touchReach(".notice")}
@media (prefers-reduced-motion: reduce) { .notice { transition: var(--glass-transition), opacity 0.3s; } }
`,
  render: notice,
  examples: [
    { label: "Done", markup: notice({ text: "Saved", tone: "done", isInPlace: true }) },
    { label: "Done, longer", markup: notice({ text: "Version 14 is live", tone: "done", isInPlace: true }) },
    { label: "A problem", markup: notice({ text: "Couldn't save: you're offline. Your changes are kept here.", tone: "problem", isInPlace: true }) },
    { label: "Done, with Undo", markup: notice({ text: "Removed Ashen Crown from your games", tone: "done", undoAction: "#notice", isInPlace: true }) },
    { label: "Two at once", markup: html`<div class="notice-stack">${notice({ text: "Copied", tone: "done", isInPlace: true })}${notice({ text: "Couldn't reach Zaisma. Check your connection.", tone: "problem", isInPlace: true })}</div>` },
  ],
});

export interface BannerOptions {
  text: string;
  icon?: IconName;
  /**
   * At most one thing to do about it: a link to follow (href, See why), or a button that posts (formAction, Turn back on), the banner
   * being its form. One of the two.
   */
  action?: { label: string; href?: string; formAction?: string };
  /** A Close at its end, for news the player can put away; what it does (hiding it, remembering) is the page script's, on its button[name="banner_close"]. */
  closeLabel?: string;
  /** "warning" for what needs the player's eye, like a held version: its icon in amber, never orange. "plain" (the default) for the rest. */
  tone?: "plain" | "warning";
}

/** The least width a banner keeps its words and its buttons side by side at; narrower, its words take the whole width and its button goes under them. */
const BANNER_SIDE_BY_SIDE_LEAST_PX = 560;
/** An icon-only cut button's width (actions.ts): the room Close takes beside a narrow banner's first line. */
const CLOSE_WIDTH_PX = 52;

/**
 * A banner: a strip of glass across the top of a page's content for something that holds while you're there (playing as a guest, a held
 * version, Zaisma's news). Its words, and at most one button and a Close in a row at its end.
 */
export function banner(options: BannerOptions): Raw {
  const formAction = options.action?.formAction;
  const action = options.action ? (formAction === undefined ? cutButton(options.action.label, { href: options.action.href ?? "#" }) : cutButton(options.action.label, { type: "submit" })) : undefined;
  const close = options.closeLabel ? cutButton(options.closeLabel, { type: "button", name: "banner_close", icon: "close", isLabelHidden: true }) : undefined;
  const controls = [action, close].filter((each): each is ControlMarkup => each !== undefined);
  const inside = html`<div class="banner-words">${options.icon ? html`<span class="banner-icon">${icon(options.icon)}</span>` : ""}<p class="banner-text">${options.text}</p></div>${controls.length ? row({ widths: "fit", alignment: "end", items: controls.map(control) }) : ""}`;
  const holder = `banner-in${options.tone === "warning" ? " tone-warning" : ""}${action ? " has-action" : ""}${close ? " has-close" : ""}`;
  return html`<div class="banner glass" data-glass data-glass-corners="header">${EDGE}${formAction === undefined ? html`<div class="${holder}">${inside}</div>` : html`<form class="${holder}" method="post" action="${formAction}">${inside}</form>`}</div>`;
}

component({
  name: "Banner",
  slug: "banner",
  group: "panes",
  summary: "Something that holds while you're on a page, across the top of its content: you're playing as a guest, a version is held, Zaisma's news on the home. A line of words, at most one button, and a Close for what a player can put away.",
  styles: `
/* A banner: a strip of the panes' glass, the width of the page's content, with a pane's two margins: what has an edge sits at the frame
   gap, so its buttons take the strip's corners, and its words keep the pane's margin. Its icon and words start at the start; its button
   and Close are a row at its end, slanting toward each other, one height, its words' first line on their center line. Narrower than
   ${BANNER_SIDE_BY_SIDE_LEAST_PX}px (by its own width), its words take the whole width, Close sits in the top end corner beside their first
   line, and the button goes under them, as wide as the strip. */
.banner { width: 100%; container-type: inline-size; padding: var(--pad-frame); --pad-words: calc(var(--pad-pane) - var(--pad-frame)); color: var(--ink); }
.banner-in { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; column-gap: var(--gap-words-control); margin: 0; }
.banner-words { display: flex; align-items: flex-start; gap: var(--gap-words-words); min-width: 0; padding: var(--pad-words); font: var(--type-words); }
.banner-in:is(.has-action, .has-close) > .banner-words { padding-block: calc((var(--control-height-regular) - 1lh) / 2); }
/* The icon sits on the words' first line. */
.banner-icon { flex: none; display: flex; align-items: center; height: 1lh; color: var(--ink-2); }
.banner-in.tone-warning .banner-icon { color: var(--warning); }
.banner-text { flex: 1 1 0; min-width: 0; margin: 0; padding: 0; color: var(--ink); }
@container (max-width: ${BANNER_SIDE_BY_SIDE_LEAST_PX - 1}px) {
  .banner-in { grid-template-columns: minmax(0, 1fr); }
  .banner-in > .banner-words { grid-area: 1 / 1; }
  .banner-in:not(.has-close) > .banner-words { padding-block-start: var(--pad-words); }
  .banner-in.has-action > .banner-words { padding-block-end: 0; }
  /* The row gives its cells to the banner: Close to the top end corner, the button to a line of its own under the words. */
  .banner-in > .layout-row { display: contents; }
  .banner .banner-in.has-close > .layout-row > .row-cell:last-child { grid-area: 1 / 1; justify-self: end; margin: 0; }
  .banner .banner-in.has-action > .layout-row > .row-cell:first-child { grid-area: 2 / 1; margin: var(--gap-words-control) 0 0; }
  .banner .banner-in.has-action > .layout-row > .row-cell:first-child > .shell { display: flex; flex: 1 1 auto; }
  .banner .banner-in.has-action > .layout-row > .row-cell:first-child > .shell > .face { width: 100%; justify-content: center; }
  /* The words make room for Close beside their first line: an empty float as wide as Close and the gap less their margin, down to its foot. */
  .banner-in.has-close .banner-text::before { content: ""; float: inline-end; width: calc(${CLOSE_WIDTH_PX}px + var(--gap-words-control) - var(--pad-words)); height: calc((var(--control-height-regular) + 1lh) / 2); }
}
`,
  render: banner,
  examples: [
    { label: "Playing as a guest", isWide: true, markup: banner({ text: "You're playing as a guest. Your progress stays on this device until you make an account.", icon: "person", action: { label: "Make an account", href: "#banner" } }) },
    { label: "A held version: the warning tone", isWide: true, markup: banner({ text: "Version 14 is held: a person looks at it, usually within a day.", icon: "clock", tone: "warning", action: { label: "See why", href: "#banner" } }) },
    { label: "A button that posts", isWide: true, markup: banner({ text: "Cloud saves are off for Ashen Crown. What you save now stays on this device.", icon: "save", action: { label: "Turn them back on", formAction: "#banner" } }) },
    { label: "News you can close", isWide: true, markup: banner({ text: "Kept rooms are here: worlds that sleep when everyone leaves and wake as they were.", icon: "megaphone", action: { label: "Read more", href: "#banner" }, closeLabel: "Close" }) },
    { label: "News you can close, with nothing to follow", isWide: true, markup: banner({ text: "Zaisma is down for upkeep on Sunday from 2:00 to 2:30 UTC. Games in progress pause and carry on after.", icon: "megaphone", closeLabel: "Close" }) },
    { label: "Words alone", isWide: true, markup: banner({ text: "This game is unlisted: only people with its link can find it.", icon: "eye" }) },
    {
      label: "Over a game's own background, its glass smoked",
      isWide: true,
      markup: html`<div class="smoke" style="width: 100%; background: center / cover no-repeat url('/design/covers/neon-drift.webp'); padding: var(--gap-block-block)">${banner({ text: "Season 3 of Neon Drift starts Friday: new districts, and the leaderboards start over.", icon: "megaphone", action: { label: "See what's new", href: "#banner" }, closeLabel: "Close" })}</div>`,
    },
  ],
});

export interface StepFlowStep {
  label: string;
  /** The step's own words and fields. Given for every step, the flow moves between them on the page and sends its form once, at the end. */
  body?: Raw;
}

export interface StepFlowOptions {
  steps: StepFlowStep[];
  /** The step shown now, from 0. */
  currentIndex: number;
  /** When each step is a page of its own (no step has a body): this step's words and fields. */
  body?: Raw;
  /** Where the form posts: each step, or once at the end when the steps carry their bodies. */
  action: string;
  /** Next's words on the last step, saying what it does ("Turn it on"). */
  finishLabel?: string;
  /** When each step is a page of its own: the step before's address, left out on the first step. */
  backHref?: string;
  /** "fit" (the default): as wide as what's in it, its paragraphs running to a reading width at most. "full": as wide as what holds it. */
  paneWidth?: "full" | "fit";
}

/**
 * A step flow: a task in a few steps (protect your account, set up a game's sign-in), a pane with a step line across its top and Back and
 * Next. Its steps are pages of their own (a body, a backHref), or all on this page (each step's body), where STEP_FLOW_SCRIPT moves between them.
 */
export function stepFlow(options: StepFlowOptions): Raw {
  const isOnPage = options.steps.every((step) => step.body !== undefined);
  const lastIndex = options.steps.length - 1;
  const stepLine = html`<ol class="step-line" aria-label="Steps">${options.steps.map((step, stepIndex) => {
    const kind = stepIndex < options.currentIndex ? "is-done" : stepIndex === options.currentIndex ? "is-current" : "";
    return html`<li${kind ? html` class="${kind}"` : ""}${stepIndex === options.currentIndex ? raw(' aria-current="step"') : ""}><span class="step-mark" aria-hidden="true"><span class="step-fill"></span></span><span class="step-label">${step.label}</span></li>`;
  })}</ol>`;
  const finishLabel = options.finishLabel ?? "Done";
  const nextLabel = options.currentIndex === lastIndex ? finishLabel : "Next";
  const paneWidth = options.paneWidth ?? "fit";
  if (!isOnPage) {
    const buttons = row({ widths: "equal", items: [...(options.backHref ? [control(cutButton("Back", { href: options.backHref }))] : []), control(runButton(nextLabel, { type: "submit" }))] });
    return glassPane({ paneWidth, body: html`${stepLine}<form class="step-form" method="post" action="${options.action}">${options.body ?? ""}${buttons}</form>` });
  }
  const bodies = options.steps.map((step, stepIndex) => html`<div class="step-body"${stepIndex === options.currentIndex ? "" : raw(" hidden")}>${step.body ?? ""}</div>`);
  const buttons = row({ widths: "equal", items: [control(cutButton("Back", { type: "button", isHidden: options.currentIndex === 0 })), control(runButton(nextLabel, { type: "submit" }))] });
  return glassPane({ paneWidth, body: html`${stepLine}<form class="step-form" method="post" action="${options.action}" data-steps="${options.currentIndex}" data-finish-label="${finishLabel}">${bodies}${buttons}</form>` });
}

/**
 * Step flows with every step on the page: Next checks the step's fields, then moves on, the step line filling to the next step; Back goes
 * back; on the last step Next sends the form. form.goToStep(index) moves to any step (the gallery starts its example over with it).
 */
export const STEP_FLOW_SCRIPT = `/* step flows */(function () {
  var LEAVE_MS = 450;
  window.zaismaWatch.each("form[data-steps]", function (form) {
    var bodies = Array.prototype.slice.call(form.querySelectorAll(":scope > .step-body")), marks = Array.prototype.slice.call(form.closest(".pane-in").querySelectorAll(".step-line > li"));
    var buttons = form.querySelector(":scope > .layout-row"), back = buttons.querySelector(".cut-btn"), next = buttons.querySelector(".run-wrap"), words = next.querySelector(".run-words:not(.label-busy)");
    var at = Number(form.getAttribute("data-steps")) || 0, last = bodies.length - 1, nextWords = "Next", finishWords = form.getAttribute("data-finish-label");
    var settling = 0;
    function mark(index) {
      marks.forEach(function (each, i) {
        each.classList.remove("is-leaving", "is-waiting"); each.classList.toggle("is-done", i < index); each.classList.toggle("is-current", i === index);
        if (i === index) each.setAttribute("aria-current", "step"); else each.removeAttribute("aria-current");
      });
    }
    function goToStep(index) {
      var from = at;
      at = Math.max(0, Math.min(last, index));
      bodies.forEach(function (body, i) { body.hidden = i !== at; });
      clearTimeout(settling);
      // Going back, the lines past the new step shrink away with the light at their tip; once they're gone the step goes back to being
      // the current one, its light at its end. Going on, the next line fills at once.
      if (at < from && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        marks.forEach(function (each, i) {
          if (i > at && (each.classList.contains("is-current") || each.classList.contains("is-done"))) { each.classList.remove("is-current", "is-done"); each.classList.add("is-leaving"); }
          each.removeAttribute("aria-current");
        });
        marks[at].classList.remove("is-done"); marks[at].classList.add("is-current", "is-waiting"); marks[at].setAttribute("aria-current", "step");
        settling = setTimeout(function () { mark(at); }, LEAVE_MS);
      } else mark(at);
      back.hidden = at === 0; if (words) words.textContent = at === last ? finishWords : nextWords;
      var first = bodies[at].querySelector("input, select, textarea, button");
      if (first && document.activeElement && form.contains(document.activeElement)) first.focus({ preventScroll: true });
    }
    form.goToStep = goToStep;
    back.addEventListener("click", function () { goToStep(at - 1); });
    form.addEventListener("submit", function (event) {
      if (at === last) return;
      event.preventDefault();
      var fields = bodies[at].querySelectorAll("input, select, textarea");
      for (var i = 0; i < fields.length; i++) if (!fields[i].checkValidity()) { fields[i].reportValidity(); return; }
      goToStep(at + 1);
    });
  });
})();
`;

const PROTECT_STEPS: StepFlowStep[] = [
  { label: "Your email", body: html`<h2>Protect your account</h2><p>An email lets you back in if you lose your password, and nothing else: we never send news.</p>${cutField({ id: "example-steps-email", name: "email", label: "Email", type: "email", icon: "mail", placeholder: "you@example.com", text: "emma@example.com" })}` },
  { label: "Check it", body: html`<h2>Check your email</h2><p>We sent a code to emma@example.com. It works for 10 minutes.</p>${cutField({ id: "example-steps-code", name: "email_code", label: "Code", type: "text", icon: "mail", text: "482 913", autocomplete: "one-time-code" })}` },
  { label: "A passkey", body: html`<h2>Add a passkey</h2><p>Your device signs you in with your face, finger or screen lock. Nobody can phish it.</p>` },
];

component({
  name: "Step flow",
  slug: "step-flow",
  group: "panes",
  summary: "A task in a few steps, like protecting your account: a pane with a thin step line across its top that fills in orange as you go, the step you're on ending in light, and Back and Next.",
  styles: `
/* A step flow: a pane whose top is a row of thin cut lines, one per step, each with its name under it. Done steps are filled orange; the one
   you're on fills in orange as you reach it, brightening to a light at its leading end, so it reads as moving on; the ones ahead are faint.
   The line runs from frame gap to frame gap, each step slanting toward the next, and its two outer ends are cut by the pane's corners as
   anything in a corner is (the corner's cut at the frame gap, from the cut tokens). Each name keeps the margin from its line's start. The
   step's words and fields come next, then Back and Next. */
.step-line { list-style: none; margin: 0; padding: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); column-gap: var(--gap-control-row); row-gap: max(var(--gap-words-control), calc(var(--pad-words) - 4px));
  container-type: inline-size; }
/* Each name sits under its line at the words' gap, or further down where the pane's margin above it is more. */
.step-line > li { display: grid; align-content: start; gap: max(var(--gap-words-control), calc(var(--pad-words) - 4px)); font: var(--type-facts); color: var(--muted); transition: color 0.3s; }
.step-mark { position: relative; display: block; height: 4px; overflow: hidden; background: var(--line); clip-path: polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%);
  --corner-start: calc(var(--pane-cut-large) - 0.586 * var(--pad-frame)); --corner-end: calc(var(--pane-cut-small) - 0.586 * var(--pad-frame)); }
.step-line > li:first-child .step-mark { clip-path: polygon(var(--corner-start) 0, 100% 0, calc(100% - 3px) 100%, calc(var(--corner-start) - 4px) 100%); }
.step-line > li:last-child .step-mark { clip-path: polygon(3px 0, calc(100% - var(--corner-end)) 0, calc(100% - var(--corner-end) + 4px) 100%, 0 100%); }
.step-line > li:only-child .step-mark { clip-path: polygon(var(--corner-start) 0, calc(100% - var(--corner-end)) 0, calc(100% - var(--corner-end) + 4px) 100%, calc(var(--corner-start) - 4px) 100%); }
.step-label { padding-inline-start: var(--pad-words); }
.step-fill { position: absolute; inset: 0; background: linear-gradient(90deg, #E9820C, var(--run)); transform: scaleX(0); transform-origin: left; transition: transform 0.6s cubic-bezier(.2,.8,.2,1); }
/* The light at the leading end of the step you're on is a layer of its own over the fill, fading in and out, so it moves from line to line
   smoothly as you go on or back. */
.step-fill::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 55%, #FFC277 82%, #FFF4E2); opacity: 0; transition: opacity 0.3s ease; }
.step-line > li:is(.is-current, .is-leaving) .step-fill::after { opacity: 1; }
.step-line > li.is-done { color: var(--ink-2); }
.step-line > li.is-done .step-fill { transform: scaleX(1); }
.step-line > li.is-current { color: var(--ink); }
.step-line > li.is-current .step-fill { transform: scaleX(1); transition-delay: 0.1s; }
@starting-style { .step-line > li.is-current .step-fill { transform: scaleX(0); } }
/* Going back, a line shrinks away with its light still at its tip, and halfway through the step it goes back to takes the light, fading in. */
.step-line > li.is-leaving .step-fill { transform: scaleX(0); transition-duration: 0.45s; transition-timing-function: cubic-bezier(.4,0,.2,1); }
.step-form { margin: 0; display: flex; flex-direction: column; gap: var(--gap-block-block); }
.step-body { display: flex; flex-direction: column; gap: var(--gap-block-block); }
/* Narrow (by the line's own width, as on a phone), only the step you're on is named, under the whole line. */
@container (max-width: 400px) {
  .step-line > li { display: contents; }
  .step-mark { grid-row: 1; }
  .step-line > li > .step-label { display: none; }
  .step-line > li.is-current > .step-label { display: block; grid-row: 2; grid-column: 1; width: 100cqi; }
}
/* Going back, the step you return to shows as current at once, its line full while the line past it shrinks away, its light fading in. */
.step-line > li.is-waiting .step-fill { transform: scaleX(1); transition: none; }
.step-line > li.is-waiting .step-fill::after { transition-delay: 0.2s; }
@media (prefers-reduced-motion: reduce) { .step-fill { transition: none; } }
`,
  render: stepFlow,
  examples: [
    { label: "Try it: Next and Back, and Turn it on starts it over", isWide: true, markup: stepFlow({ steps: PROTECT_STEPS, currentIndex: 0, action: "#step-flow", finishLabel: "Turn it on" }) },
    {
      label: "The second step, as a page of its own",
      markup: stepFlow({ steps: PROTECT_STEPS.map(({ label }) => ({ label })), currentIndex: 1, action: "#step-flow", backHref: "#step-flow", body: html`<h2>Check your email</h2><p>We sent a code to emma@example.com. It works for 10 minutes.</p>${cutField({ id: "example-step-code", name: "email_code", label: "Code", type: "text", icon: "mail", autocomplete: "one-time-code" })}` }),
    },
    {
      label: "A problem on a step",
      markup: stepFlow({ steps: PROTECT_STEPS.map(({ label }) => ({ label })), currentIndex: 1, action: "#step-flow", backHref: "#step-flow", body: html`<h2>Check your email</h2><p>We sent a code to emma@example.com. It works for 10 minutes.</p>${cutField({ id: "example-step-code-wrong", name: "email_code", label: "Code", type: "text", icon: "mail", text: "482 931", autocomplete: "one-time-code", error: "That code doesn't match. Check the newest email from Zaisma, or go back to send another." })}` }),
    },
    {
      label: "Long step names",
      markup: stepFlow({ steps: [{ label: "Your email address" }, { label: "The code we sent you" }, { label: "A passkey on this device" }], currentIndex: 2, action: "#step-flow", backHref: "#step-flow", finishLabel: "Add a passkey", body: html`<h2>Add a passkey</h2><p>Your device signs you in with your face, finger or screen lock. Nobody can phish it.</p>` }),
    },
    {
      label: "Five steps",
      markup: stepFlow({
        steps: [{ label: "Make it" }, { label: "Upload" }, { label: "Check" }, { label: "Cover" }, { label: "Publish" }],
        currentIndex: 3,
        action: "#step-flow",
        backHref: "#step-flow",
        body: html`<h2>Give it a cover</h2><p>It's what players see in every list: your art alone, 16 by 9, with nothing drawn over it.</p>${cutField({ id: "example-steps-title", name: "title", label: "Title", type: "text", icon: "games", text: "The Last Lighthouse Keeper" })}`,
      }),
    },
  ],
});

// Spacing sits here, where every component it shows can be imported (foundations.ts can't import them).
// data-spacing-show marks the space it's about (GALLERY_SCRIPT draws it): "gap" between the children of what data-spacing-of
// picks (or of itself), "pad" inside it.
const spacingExample = (token: string, body: Raw) => html`<div class="spacing-example"><code>${token}</code>${body}</div>`;
const spacingPane = (body: Raw) => glassPane({ paneWidth: "fit", body });
component({
  name: "Spacing",
  slug: "spacing",
  group: "foundations",
  summary: "Every gap, padding and margin is one of these tokens, picked by what sits on each side of it, never by how close two things feel. A control is anything from Actions & Inputs; words are a heading, label or line; a block is a group of controls with their words, a paragraph, a picture or a pane. If either side is a block, it's --gap-block-block. More room is a multiple of one, never a new number.",
  styles: `
/* Spacing: the space each example is about, hatched over it. */
.spacing-example { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--gap-words-control); justify-items: start; width: 100%; }
.spacing-example > code { font: var(--type-code); color: var(--ink); }
.spacing-mark { position: absolute; z-index: 6; pointer-events: none;
  background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--ink) 34%, transparent) 0 1.5px, transparent 1.5px 5px);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 40%, transparent); }
`,
  examples: [
    {
      label: "Between the slants of two controls side by side (their boxes overlap by --control-slant less this), and the edge rule's neighbor distance: 4px",
      markup: spacingExample("--gap-control-row", html`<div class="control-row" data-spacing-show="gap">${runButton("Play", { type: "button", icon: "play" })}${cutButton("Details", { type: "button" })}</div>`),
    },
    {
      label: "Two controls stacked: 8px",
      markup: spacingExample("--gap-control-stack", spacingPane(html`<div class="edge-stack" data-spacing-show="gap">${cutButton("Settings", { type: "button", isFullWidth: true })}${cutButton("Account", { type: "button", isFullWidth: true })}${cutButton("Sign out", { type: "button", isFullWidth: true })}</div>`)),
    },
    {
      label: "A control and the words that belong to it: 8px",
      markup: spacingExample("--gap-words-control", spacingPane(html`<div data-spacing-show="gap" data-spacing-of=".cut-field">${cutField({ id: "spacing-username", name: "username", label: "Username", type: "text", icon: "person", text: "emma_r", autocomplete: "off" })}</div>`)),
    },
    {
      label: "Words beside or under words in one block, an icon and its word: 8px",
      markup: spacingExample("--gap-words-words", spacingPane(html`<div data-spacing-show="gap" data-spacing-of=".glance">${glanceFacts({ playerCount: 1204, playedAtMs: Date.now() - 2 * 60 * 60_000 })}</div>`)),
    },
    {
      label: "Two blocks, here two labeled fields in a pane: 24px",
      markup: spacingExample("--gap-block-block", html`<div data-spacing-show="gap" data-spacing-of=".layout-stack">${spacingPane(stack({ items: [{ kind: "control", markup: cutField({ id: "spacing-name", name: "username", label: "Username", type: "text", icon: "person", autocomplete: "off" }) }, { kind: "control", markup: cutField({ id: "spacing-email", name: "email", label: "Email", type: "email", icon: "mail", autocomplete: "off" }) }] }))}</div>`),
    },
    {
      label: "A pane's edge and anything with an edge of its own (a button, a field, a cover, a table): the frame gap, 12px (10px on a phone)",
      markup: spacingExample("--pad-frame", html`<div data-spacing-show="pad" data-spacing-of=".pane-in">${spacingPane(runButton("Sign in", { type: "button", isFullWidth: true }))}</div>`),
    },
    {
      label: "A pane's edge and its words: 24px (18px on a phone), --pad-words further in than the frame gap",
      markup: spacingExample("--pad-pane", html`<div data-spacing-show="pad" data-spacing-of=".stack-cell.is-words">${spacingPane(stack({ items: [{ kind: "words", markup: html`<h2>Welcome back</h2>` }, { kind: "control", markup: runButton("Sign in", { type: "button", isFullWidth: true }) }] }))}</div>`),
    },
    {
      label: "An inner pane's edge (the birthday picker, a menu) and a bar's (the header): 12px",
      markup: spacingExample("--pad-inner-pane", spacingPane(html`<div data-spacing-show="pad" data-spacing-of=".bday-pick">${birthdayField({ id: "spacing-bday", name: "birthday", label: "When's your birthday?", state: "open" })}</div>`)),
    },
  ],
});
