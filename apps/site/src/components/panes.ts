import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE, EDGE, PANE_SIZES, ago, glassPane, icon, sheetMarkup, tag, tray, type IconName } from "./foundations.ts";
import { glanceFacts, pictureRow, type GlanceFacts } from "./data.ts";
import { cutButton, runButton } from "./actions.ts";
import { REPORT_REASONS, birthdayField, choiceCards, cutField, longField } from "./inputs.ts";

/*
 * Panes: Zaisma's glass as a sheet that holds things (the sign-in's pane), a menu that hangs
 * from a button, and a game's cover. From the sign-in, header and home drafts.
 */


/** A dropdown's choice: a link, or a button that posts a form (like Sign out). */
export interface DropdownChoice {
  label: string;
  href?: string;
  /** Where a button posts, in place of a link. */
  action?: string;
  /** The page you're on, or the choice that's made: it sits on a slab with the orange line, like a switch's. */
  isCurrent?: boolean;
  icon?: IconName;
  /** A small number at its end, like unread replies: a Tag. */
  badgeCount?: number;
}

/** A dropdown's item: a choice, or a rule between groups of them. */
export type DropdownItem = DropdownChoice | { kind: "rule" };

/** One choice in a dropdown: words with an icon, a faint slab under the pointer, the slab with the orange line when it's the current one. */
function dropdownChoice(choice: DropdownChoice): Raw {
  const inside = html`${CUT_LINE}${choice.icon ? icon(choice.icon) : ""}<span>${choice.label}</span>${choice.badgeCount ? tag(choice.badgeCount, "count") : ""}`;
  const shared = html` class="dropdown-choice" role="menuitem" tabindex="-1" data-cut-line="8"${choice.isCurrent ? raw(' aria-current="page"') : ""}`;
  return choice.action !== undefined
    ? html`<form class="dropdown-form" method="post" action="${choice.action}"><button type="submit"${shared}>${inside}</button></form>`
    : html`<a href="${choice.href ?? "#"}"${shared}>${inside}</a>`;
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
  return html`<div class="dropdown glass${options.isOpen ? "" : " shut"}" id="${options.id}" role="menu" aria-label="${options.label}" aria-hidden="${options.isOpen ? "false" : "true"}" data-glass data-glass-corners="18 14 18 14">${EDGE}${options.head ? html`<div class="dropdown-head"><strong>${options.head.title}</strong>${options.head.note ? html`<span>${options.head.note}</span>` : ""}</div>` : ""}${options.items.map((menuItem) =>
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
export const DROPDOWN_SCRIPT = `/* menus */(function () {
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
  var menus = Array.prototype.slice.call(document.querySelectorAll('.dropdown[role="menu"]'));
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
    if (!menu || !menu.matches('.dropdown[role="menu"]')) return;
    toggle(menu, button.getAttribute("aria-expanded") !== "true", event.detail === 0);
  });
  document.addEventListener("pointerdown", function (event) {
    menus.forEach(function (menu) { var button = buttonOf(menu); if (!menu.classList.contains("shut") && !menu.contains(event.target) && !(button && button.contains(event.target))) toggle(menu, false); });
  });
  function placeAll() { menus.forEach(place); }
  window.zaismaWatch.resize(placeAll);
  window.zaismaWatch.scroll(placeAll);
})();
`;

const DROPDOWN_STYLES = `
/* A dropdown: a pane of the glass hanging just under its button, holding a short list of choices. */
.dropdown { position: fixed; z-index: 11; width: 260px; padding: var(--pad-inner-pane); --glass-tint: var(--glass-dropdown);
  display: flex; flex-direction: column; gap: 2px;
  transform-origin: top right; transition: var(--glass-transition), opacity 0.25s, transform 0.35s cubic-bezier(.2,.8,.2,1); }
.dropdown.shut { opacity: 0; transform: translateY(-6px) scale(0.98); pointer-events: none; visibility: hidden; transition: var(--glass-transition), opacity 0.25s, transform 0.35s cubic-bezier(.2,.8,.2,1), visibility 0s 0.35s; }
.dropdown-head { display: flex; flex-direction: column; padding: 0 14px var(--gap-words-control); margin-bottom: var(--gap-words-control); border-bottom: var(--divider); }
.dropdown-head strong { font: var(--type-name); color: var(--ink); }
.dropdown-head span { color: var(--muted); font: var(--type-facts); }
.dropdown hr { border: 0; border-top: var(--divider); margin: 6px 4px; }
/* A choice: words on the glass; under the pointer a faint slab, cut by the edge rule; the current one on the switch's slab with its orange line. */
.dropdown-form { margin: 0; }
.dropdown-choice { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; height: 40px; padding: 0 14px; margin: 0; border: 0; cursor: pointer;
  font: var(--type-words); color: var(--ink-2); text-align: left; text-decoration: none;
  --face-color: transparent; background: var(--face-color); clip-path: var(--cut-shape); transition: --face-color 0.15s, color 0.15s; }
.dropdown-choice > :not(.cut-line) { position: relative; z-index: 2; }
.dropdown-choice > .tag { margin-left: auto; }
.dropdown-choice:hover, .dropdown-choice:focus-visible { --face-color: var(--ghost); color: var(--ink); }
.dropdown-choice[aria-current="page"] { color: var(--ink); background: var(--slab); box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run); }
.dropdown-choice:focus-visible { outline: none; }
.dropdown-choice:focus-visible > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
@media (prefers-reduced-motion: reduce) { .dropdown { transition: var(--glass-transition); } }
`;

const PANE_STYLES = `
/* The pane: Zaisma's glass, the same as the home's and the header's. No sheen. Small, medium and large are 320, 480 and 720 wide; full is the whole width. */
.glass-pane { display: flex; flex-direction: column; max-width: 100%; }
.glass-pane.small { width: ${PANE_SIZES.small}px; }
.glass-pane.medium { width: ${PANE_SIZES.medium}px; }
.glass-pane.large { width: ${PANE_SIZES.large}px; }
.glass-pane.full { width: 100%; }
.glass-pane { position: relative; }
/* Long content scrolls inside it, on Zaisma's own rail (RAIL_SCRIPT gives any box that scrolls one). */
.glass-pane > .pane-in { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--gap-block-block); padding: var(--pad-pane); }
/* With its rail, the pane keeps room for it along its right edge, so the rail never sits against what's in it. */
.glass-pane > .pane-in.own-scroll { padding-right: calc(var(--pad-pane) + 16px); }
/* Nothing in the pane shrinks when its content is long: it scrolls instead. */
.glass-pane > .pane-in > * { flex-shrink: 0; }
/* A form in a pane stacks what it holds as the pane does, and so does any group of blocks in it (pane-stack: a step that shows or hides). */
.glass-pane > .pane-in form, .glass-pane .pane-stack { display: flex; flex-direction: column; gap: var(--gap-block-block); }
/* A page's own heading (h1) when the pane is the page, or one of a few on it (h2). */
.glass-pane :is(h1, h2) { margin: 0; font: var(--type-heading); text-wrap: balance; }
.glass-pane p { margin: 0; color: var(--ink-2); }
`;

const COVER_STYLES = `
/* Covers are the studios' art alone: no rim, no glass, nothing drawn on them. */
.cover { position: relative; min-width: 0; }
.cover-art { position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; background: rgba(20,30,50,0.12);
  box-shadow: 0 4px 10px rgba(10,20,40,0.16); transition: box-shadow 0.2s ease-out; }
.cover-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.cover:hover .cover-art, .cover-art:focus-visible { box-shadow: 0 6px 14px rgba(10,20,40,0.24); }
.cover-art:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
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
.cover-meta { display: flex; align-items: center; gap: var(--gap-words-words); min-height: 24px; margin-top: var(--gap-words-words); font: var(--type-facts); color: var(--muted); white-space: nowrap; }
.cover-meta .ico { width: 15px; height: 15px; stroke-width: 1.5; }
.cover-meta .when, .cover-meta .count, .cover-meta .friends { display: inline-flex; align-items: center; gap: var(--gap-words-words); min-width: 0; }
.cover-meta .friends { color: var(--ink); font-weight: 600; overflow: hidden; }
.cover-meta .friends > span:last-child { overflow: hidden; text-overflow: ellipsis; }
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

const ACCOUNT_ITEMS: DropdownItem[] = [
  { label: "Your profile", icon: "person", href: "#dropdown" },
  { label: "Friends", icon: "friends", href: "#dropdown" },
  { label: "Developer", icon: "code", href: "#dropdown" },
  { label: "Settings", icon: "gear", href: "#dropdown" },
  { kind: "rule" },
  { label: "Sign out", icon: "sign-out", action: "#dropdown" },
];
/** An example menu hanging from its button, open. */
const dropdownFrame = (buttonLabel: string, options: DropdownOptions) =>
  html`<div class="dropdown-frame">${cutButton(buttonLabel, { type: "button", controls: options.id, isExpanded: true })}${dropdown({ ...options, isOpen: true })}</div>`;

component({
  name: "Tray",
  slug: "tray",
  group: "panes",
  summary: "A thinner, clearer sheet a pane extends into, holding everything that belongs to it: the pane's words on top, what they're about on the tray beneath, read as one. Every gallery section is one.",
  styles: `
/* A tray: the pane above holds the words, square along its foot; the tray runs on from it with no rim of its own along the top. It's
   the same glass, light or smoked, only thinner and muted, so the pane stands out and the tray stays in the background: a clearer
   tint (--glass-tray), a fainter sheen (--glass-tray-sheen), less blur, the colors behind it less lifted, and a fainter rim, its bevel as wide. */
.tray-group { display: flex; flex-direction: column; }
.tray-head { padding: var(--pad-pane); }
/* Thinner glass, closer padding: a tray sits its pieces nearer its edge than a pane does (--pad-tray, not --pad-pane), still clear of its cut foot. */
.tray { --glass-tint: var(--glass-tray); --glass-sheen: var(--glass-tray-sheen); --glass-blur: 12px; --glass-saturate: 1.15; padding: var(--pad-tray); }
.tray > .edge { opacity: 0.45; }
.tray-sample-title { margin: 0; font: var(--type-section); }
.tray-sample-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--gap-block-block); }
`,
  render: tray,
  examples: [
    {
      label: "A head, and what it's about on the tray",
      isWide: true,
      markup: tray({ head: html`<h3 class="tray-sample-title">Your games</h3>`, body: html`<div class="control-row">${runButton("Play", { type: "button", icon: "play" })}${cutButton("Details", { type: "button" })}</div>` }),
    },
    {
      label: "Holding a row of covers",
      isWide: true,
      markup: tray({ head: html`<h3 class="tray-sample-title">Continue playing</h3>`, body: html`<div class="tray-sample-row">${Object.values(STAND_IN_COVERS).slice(0, 3).map((cover) => cover)}</div>` }),
    },
  ],
});

component({
  name: "Dropdown",
  slug: "dropdown",
  group: "panes",
  summary: "A short list of choices that hangs from a button, like the account button's in the header: with a head, rules, icons, counts and the current one, as each needs.",
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

export interface SheetOptions {
  /** Unique on the page: the button that opens it names it (cutButton's controls). */
  id: string;
  title: string;
  body: Raw;
  /** What its close button says to a screen reader: "Close". */
  closeLabel: string;
  /** Open in place rather than over the page: the gallery's still copy. */
  isShown?: boolean;
}

/** A sheet: a pane of glass over the dimmed page for a task that comes and goes (report a game, block someone), opened by a button that names it. */
export function sheet(options: SheetOptions): Raw {
  return sheetMarkup({ id: options.id, title: options.title, body: options.body, closeButton: cutButton(options.closeLabel, { type: "submit", icon: "close", isLabelHidden: true, isSmall: true }), isShown: options.isShown });
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
  isShown?: boolean;
}

/** A confirm sheet: one sentence, the action and Cancel, before something that's hard to take back. A delete's is Delete button's own, the only red one. */
export function confirmSheet(options: ConfirmSheetOptions): Raw {
  const body = html`<p class="sheet-text">${options.text}</p><form class="sheet-form" method="post" action="${options.action}"><div class="control-row">${cutButton("Cancel", { type: "submit", formMethod: "dialog", isAutofocused: true })}${runButton(options.confirmLabel, { type: "submit" })}</div></form>`;
  return sheet({ id: options.id, title: options.title, body, closeLabel: "Close", isShown: options.isShown });
}

/** Sheets: a button that names one (aria-controls, with no aria-expanded: that's a dropdown) opens it over the page; a press on the dimmed page round it closes it. Esc and its own buttons close it natively. */
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

const SHEET_STYLES = `
/* A sheet: a dialog of the panes' glass over the page, which dims behind it (dimmed, not blurred, so it stays cheap). It comes up a
   little as it opens and drops away as it closes, the dimming fading with it; nothing in it waits for that. Centered on a wide screen; on
   a phone it rises from the foot of the screen, a gap from its edges. What's in it scrolls inside it, under its head. */
.sheet { width: min(480px, calc(100% - 2 * var(--pad-pane))); max-width: none; max-height: calc(100dvh - 2 * var(--pad-pane)); margin: auto; padding: 0; border: 0; overflow: visible; color: var(--ink);
  --glass-tint: var(--glass-dropdown);
  transition: var(--glass-transition), opacity 0.25s, transform 0.3s cubic-bezier(.2,.8,.2,1), overlay 0.3s allow-discrete, display 0.3s allow-discrete; }
/* Over the page, fixed to the window whether it's opening, open or closing (it stops being :modal the moment it starts to close). */
.sheet:not(.in-place) { position: fixed; inset: 0; z-index: 40; }
.sheet:not([open]) { opacity: 0; transform: translateY(16px) scale(0.98); transition-timing-function: ease, ease, cubic-bezier(.4,0,1,1); }
@starting-style { .sheet[open] { opacity: 0; transform: translateY(12px) scale(0.985); } }
.sheet::backdrop { background: rgba(6, 9, 14, 0.42); opacity: 1; transition: opacity 0.3s, overlay 0.3s allow-discrete, display 0.3s allow-discrete; }
.sheet:not([open])::backdrop { opacity: 0; }
@starting-style { .sheet[open]::backdrop { opacity: 0; } }
/* In place (the gallery's still copy): a pane where it sits. */
.sheet.in-place { position: relative; z-index: auto; margin: 0; }
.sheet-in { display: flex; flex-direction: column; gap: var(--gap-block-block); max-height: inherit; overflow-y: auto; padding: var(--pad-pane); }
/* With a mouse it scrolls on Zaisma's rail, inside its right edge: what's in it keeps clear of the rail. */
.sheet-in.own-scroll:has(+ .rail:not([hidden])) { padding-right: calc(var(--pad-pane) + 14px); }
.sheet-head { display: flex; align-items: flex-start; gap: var(--gap-words-control); }
.sheet-title { flex: 1; margin: 0; font: var(--type-section); color: var(--ink); text-wrap: balance; }
.sheet-close, .sheet-form { margin: 0; }
.sheet-text { margin: 0; font: var(--type-words); color: var(--ink-2); }
@media (max-width: 760px) {
  /* On a phone it rises from the foot of the screen and stops well short of the top, so the page stays in view above it. */
  .sheet:not(.in-place) { width: calc(100% - 2 * var(--gap-control-stack)); max-height: 78dvh; margin: auto var(--gap-control-stack) var(--gap-control-stack); }
  .sheet:not(.in-place):not([open]) { transform: translateY(40px); }
  /* A sheet's buttons stack on a phone, each the sheet's full width, the action under Cancel. */
  .sheet-form .control-row { flex-direction: column; align-items: stretch; }
  .sheet-form .control-row > * { flex: none; margin-inline-end: 0; }
  @starting-style { .sheet:not(.in-place)[open] { transform: translateY(40px); } }
}
@media (prefers-reduced-motion: reduce) { .sheet { transition: var(--glass-transition), opacity 0.2s, overlay 0.2s allow-discrete, display 0.2s allow-discrete; } .sheet:not([open]) { transform: none; } }
`;

const reportBody = (idPrefix: string) =>
  html`${choiceCards({ id: `${idPrefix}-reason`, name: `report_reason_${idPrefix}`, label: "What's wrong", choices: REPORT_REASONS, pickedValue: "broken", isCompact: true })}${longField({ id: `${idPrefix}-details`, name: "report_text", label: "What you saw", rowCount: 3, maximumCharacterCount: 2000 })}${runButton("Send report", { type: "button", isFullWidth: true })}`;

component({
  name: "Sheet",
  slug: "sheet",
  group: "panes",
  summary: "A task that comes and goes over the page: report a game, block someone, add a key. Opened by a button that names it; Esc, its close button or a press beside it close it.",
  styles: SHEET_STYLES,
  render: sheet,
  examples: [
    { label: "Try it: from its button", markup: html`${cutButton("Report this game", { type: "button", controls: "example-sheet-try" })}${sheet({ id: "example-sheet-try", title: "Report Ashen Crown", body: reportBody("example-sheet-try"), closeLabel: "Close" })}` },
    { label: "Open", markup: sheet({ id: "example-sheet-shown", title: "Report Ashen Crown", body: reportBody("example-sheet-shown"), closeLabel: "Close", isShown: true }), isWide: true, isStill: true },
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
  ],
});

export interface NoticeOptions {
  text: string;
  /** "done": something just went through (Saved), and it leaves by itself after 4 s. "problem": something didn't, and it stays until it's closed. */
  tone: "done" | "problem";
  /** Where it sits rather than floating under the header: the gallery's still copies. */
  isInPlace?: boolean;
}

/** A notice: a moment that just happened ("Saved", "Couldn't save: you're offline"), in the header's glass just under the header. */
export function notice(options: NoticeOptions): Raw {
  const isProblem = options.tone === "problem";
  return html`<div class="notice glass ${options.tone}${options.isInPlace ? " in-place" : ""}" role="${isProblem ? "alert" : "status"}" data-notice="${options.tone}" data-glass data-glass-corners="18 14 18 14">${EDGE}${icon(isProblem ? "warning" : "check")}<span class="notice-text">${options.text}</span>${isProblem ? cutButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true }) : ""}</div>`;
}

/** Notices: one that's done leaves after 4 s (it waits while you point at it); a problem leaves when its close button is pressed. Notices a page adds later are watched too. */
export const NOTICE_SCRIPT = `/* notices */(function () {
  var STAY_MS = 4000, LEAVE_MS = 300;
  // One in place (the gallery's still copy) comes back a moment after it leaves, so it can be tried again.
  function leave(el) {
    if (el.classList.contains("is-leaving")) return; el.classList.add("is-leaving");
    if (el.classList.contains("in-place")) setTimeout(function () { el.classList.remove("is-leaving"); }, 1600); else setTimeout(function () { el.remove(); }, LEAVE_MS);
  }
  function wait(el) { clearTimeout(el.noticeTimer); el.noticeTimer = setTimeout(function () { leave(el); }, STAY_MS); }
  function arrive(el) {
    if (el.noticeArrived || el.classList.contains("in-place")) return; el.noticeArrived = true;
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
  summary: "A moment that just happened, just under the header: Saved, Copied, or what went wrong. A done one leaves by itself after 4 seconds; a problem stays until it's closed.",
  styles: `
/* A notice: a small slab of the header's glass floating just under the header, in the middle. It comes down a little as it arrives
   and fades up as it leaves. A done one carries a green tick, a problem the warning in the marked color and a close button. */
.notice { position: fixed; z-index: 30; top: var(--under-header, 96px); left: 0; right: 0; width: max-content; max-width: calc(100% - 2 * var(--pad-pane)); margin: 0 auto;
  display: flex; align-items: center; gap: var(--gap-words-words); min-height: 52px; padding: var(--pad-inner-pane) var(--pad-tray); --glass-tint: var(--glass-top);
  font: var(--type-words); color: var(--ink);
  transition: var(--glass-transition), opacity 0.3s, transform 0.3s cubic-bezier(.2,.8,.2,1); }
@starting-style { .notice { opacity: 0; transform: translateY(-8px); } }
.notice.is-leaving { opacity: 0; transform: translateY(-8px); }
.notice.in-place { position: relative; top: auto; left: auto; right: auto; z-index: auto; margin: 0; }
.notice > .ico { width: 20px; height: 20px; }
.notice.done > .ico { color: var(--online); stroke-width: 2.4; }
.notice.problem > .ico { color: var(--marked); }
.notice.problem { padding-right: var(--pad-inner-pane); }
.notice-text { min-width: 0; }
@media (prefers-reduced-motion: reduce) { .notice { transition: var(--glass-transition), opacity 0.3s; } }
`,
  render: notice,
  examples: [
    { label: "Done", markup: notice({ text: "Saved", tone: "done", isInPlace: true }) },
    { label: "Done, longer", markup: notice({ text: "Version 14 is live", tone: "done", isInPlace: true }) },
    { label: "A problem", markup: notice({ text: "Couldn't save: you're offline. Your changes are kept here.", tone: "problem", isInPlace: true }) },
  ],
});

export interface BannerOptions {
  text: string;
  icon?: IconName;
  /** At most one thing to do about it. */
  action?: { label: string; href: string };
}

/** A banner: a strip of glass across the top of a page's content for something that holds while you're there (playing as a guest, a held version). One line and at most one button. */
export function banner(options: BannerOptions): Raw {
  return html`<div class="banner glass" data-glass data-glass-corners="20 14 20 14">${EDGE}${options.icon ? icon(options.icon) : ""}<span class="banner-text">${options.text}</span>${options.action ? cutButton(options.action.label, { href: options.action.href }) : ""}</div>`;
}

component({
  name: "Banner",
  slug: "banner",
  group: "panes",
  summary: "Something that holds while you're on a page, across the top of its content: you're playing as a guest, a version is held. One line, and at most one button.",
  styles: `
/* A banner: a strip of the panes' glass, the width of the page's content, holding one line of words and at most one cut button at its
   end, which fits the strip's corners. On a phone the button goes under the words. */
.banner { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-control-stack) var(--gap-words-control); width: 100%; min-height: 60px; padding: var(--pad-inner-pane) var(--pad-inner-pane) var(--pad-inner-pane) var(--pad-tray); font: var(--type-words); color: var(--ink); }
.banner > .ico { flex: none; color: var(--ink-2); }
.banner-text { flex: 1 1 0; min-width: 0; }
.banner > .cut-btn { flex: none; }
@media (max-width: 760px) { .banner > .cut-btn { flex: 1 1 100%; } }
`,
  render: banner,
  examples: [
    { label: "Playing as a guest", isWide: true, markup: banner({ text: "You're playing as a guest. Your progress stays on this device until you make an account.", icon: "person", action: { label: "Make an account", href: "#banner" } }) },
    { label: "A held version", isWide: true, markup: banner({ text: "Version 14 is held: a person looks at it, usually within a day.", icon: "clock", action: { label: "See why", href: "#banner" } }) },
    { label: "Words alone", isWide: true, markup: banner({ text: "This game is unlisted: only people with its link can find it.", icon: "eye" }) },
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
  if (!isOnPage) {
    const buttons = html`<div class="control-row">${options.backHref ? cutButton("Back", { href: options.backHref }) : ""}${runButton(nextLabel, { type: "submit" })}</div>`;
    return glassPane({ paneSize: "medium", body: html`${stepLine}<form class="step-form" method="post" action="${options.action}">${options.body ?? ""}${buttons}</form>` });
  }
  const bodies = options.steps.map((step, stepIndex) => html`<div class="step-body"${stepIndex === options.currentIndex ? "" : raw(" hidden")}>${step.body ?? ""}</div>`);
  const buttons = html`<div class="control-row" data-step-buttons>${cutButton("Back", { type: "button", isHidden: options.currentIndex === 0 })}${runButton(nextLabel, { type: "submit" })}</div>`;
  return glassPane({ paneSize: "medium", body: html`${stepLine}<form class="step-form" method="post" action="${options.action}" data-steps="${options.currentIndex}" data-finish-label="${finishLabel}">${bodies}${buttons}</form>` });
}

/**
 * Step flows with every step on the page: Next checks the step's fields, then moves on, the step line filling to the next step; Back goes
 * back; on the last step Next sends the form. form.goToStep(index) moves to any step (the gallery starts its example over with it).
 */
export const STEP_FLOW_SCRIPT = `/* step flows */(function () {
  var LEAVE_MS = 450;
  document.querySelectorAll("form[data-steps]").forEach(function (form) {
    var bodies = Array.prototype.slice.call(form.querySelectorAll(":scope > .step-body")), marks = Array.prototype.slice.call(form.closest(".pane-in").querySelectorAll(".step-line > li"));
    var back = form.querySelector("[data-step-buttons] > .cut-btn"), next = form.querySelector("[data-step-buttons] > .run-wrap"), words = next.querySelector(".run > span:not([class])");
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
      back.hidden = at === 0; words.textContent = at === last ? finishWords : nextWords;
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
/* A step flow: a pane whose top is a row of thin cut lines, one per step, each with its name under it (on a phone, only the one you're
   on). Done steps are filled orange; the one you're on fills in orange as you reach it, brightening to a light at its leading end, so it
   reads as moving on; the ones ahead are faint. The step's words and fields come next, then Back and Next. */
.step-line { list-style: none; margin: 0; padding: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--gap-control-row); }
.step-line > li { display: grid; gap: var(--gap-words-control); font: var(--type-facts); color: var(--muted); transition: color 0.3s; }
.step-mark { position: relative; display: block; height: 4px; overflow: hidden; background: var(--line); clip-path: polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%); }
.step-fill { position: absolute; inset: 0; background: linear-gradient(90deg, #E9820C, var(--run)); transform: scaleX(0); transform-origin: left; transition: transform 0.6s cubic-bezier(.2,.8,.2,1); }
.step-line > li.is-done { color: var(--ink-2); }
.step-line > li.is-done .step-fill { transform: scaleX(1); }
.step-line > li.is-current { color: var(--ink); }
.step-line > li.is-current .step-fill { transform: scaleX(1); transition-delay: 0.1s; background: linear-gradient(90deg, #E9820C, var(--run) 55%, #FFC277 82%, #FFF4E2); }
@starting-style { .step-line > li.is-current .step-fill { transform: scaleX(0); } }
/* Going back, a line shrinks away with its light still at its tip, before the step it goes back to takes the light. */
.step-line > li.is-leaving .step-fill { transform: scaleX(0); transition-duration: 0.45s; transition-timing-function: cubic-bezier(.4,0,.2,1); background: linear-gradient(90deg, #E9820C, var(--run) 55%, #FFC277 82%, #FFF4E2); }
.step-form { margin: 0; display: flex; flex-direction: column; gap: var(--gap-block-block); }
.step-body { display: flex; flex-direction: column; gap: var(--gap-block-block); }
/* On a phone only the current step's name shows; the others keep their line's room, so nothing moves as the step changes. */
@media (max-width: 760px) { .step-line > li > .step-label { white-space: nowrap; } .step-line > li:not(.is-current) > .step-label { visibility: hidden; } }
/* Going back, the step you return to shows as current at once, its line solid until the line past it has shrunk away. */
.step-line > li.is-waiting .step-fill { transform: scaleX(1); background: linear-gradient(90deg, #E9820C, var(--run)); transition: none; }
@media (prefers-reduced-motion: reduce) { .step-fill { transition: none; } }
`,
  render: stepFlow,
  examples: [
    { label: "Try it: Next and Back, and Turn it on starts it over", isWide: true, markup: stepFlow({ steps: PROTECT_STEPS, currentIndex: 0, action: "#step-flow", finishLabel: "Turn it on" }) },
    {
      label: "The second step, as a page of its own",
      markup: stepFlow({ steps: PROTECT_STEPS.map(({ label }) => ({ label })), currentIndex: 1, action: "#step-flow", backHref: "#step-flow", body: html`<h2>Check your email</h2><p>We sent a code to emma@example.com. It works for 10 minutes.</p>${cutField({ id: "example-step-code", name: "email_code", label: "Code", type: "text", icon: "mail", autocomplete: "one-time-code" })}` }),
    },
  ],
});

// Spacing sits here, where every component it shows can be imported (foundations.ts can't import them).
// data-spacing-show marks the space it's about (GALLERY_SCRIPT draws it): "gap" between the children of what data-spacing-of
// picks (or of itself), "pad" inside it.
const spacingExample = (token: string, body: Raw) => html`<div class="spacing-example"><code>${token}</code>${body}</div>`;
const spacingPane = (body: Raw) => glassPane({ paneSize: "small", body });
component({
  name: "Spacing",
  slug: "spacing",
  group: "foundations",
  summary: "Every gap, padding and margin is one of seven tokens, picked by what sits on each side of it, never by how close two things feel. A control is anything from Actions & Inputs; words are a heading, label or line; a block is a group of controls with their words, a paragraph, a picture or a pane. If either side is a block, it's --gap-block-block. More room is a multiple of one, never a new number.",
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
      markup: spacingExample("--gap-words-words", spacingPane(html`<div data-spacing-show="gap" data-spacing-of=".glance">${glanceFacts({ playerCount: 1204, friends: [{ username: "Liam" }, { username: "Sofia" }] })}</div>`)),
    },
    {
      label: "Two blocks, here two labeled fields in a pane: 24px",
      markup: spacingExample("--gap-block-block", html`<div class="glass example-pane" data-glass data-glass-corners="24 20 24 20" data-spacing-show="gap">${cutField({ id: "spacing-name", name: "username", label: "Username", type: "text", icon: "person", autocomplete: "off" })}${cutField({ id: "spacing-email", name: "email", label: "Email", type: "email", icon: "mail", autocomplete: "off" })}</div>`),
    },
    {
      label: "A pane's edge and what's in it, and the page's edge: 24px (18px on a phone)",
      markup: spacingExample("--pad-pane", html`<div class="glass example-pane" data-glass data-glass-corners="24 20 24 20" data-spacing-show="pad">${runButton("Sign in", { type: "button", isFullWidth: true })}</div>`),
    },
    {
      label: "An inner pane's edge (the birthday picker, a menu) and a bar's (the header): 12px",
      markup: spacingExample("--pad-inner-pane", spacingPane(html`<div data-spacing-show="pad" data-spacing-of=".bday-pick">${birthdayField({ id: "spacing-bday", name: "birthday", label: "When's your birthday?", state: "open" })}</div>`)),
    },
  ],
});

