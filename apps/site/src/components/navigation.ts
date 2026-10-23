import { html, raw, type Raw } from "../markup.ts";
import { pageScript } from "../page-scripts.ts";
import { component } from "./component.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { CUT_LINE, EDGE, glassPane, icon, logo, railMarkup, type IconName } from "./foundations.ts";
import { cutPolygon } from "./tokens.ts";
import { cutButton, runButton, textLink } from "./actions.ts";
import { searchField, tabSwitch, type SearchFieldOptions, type SwitchTab } from "./inputs.ts";
import { STAND_IN_COVERS, dropdown, type DropdownItem } from "./panes.ts";
import { listRows, pictureFrame } from "./data.ts";
import { row, stack, track, type LayoutItem } from "./layout.ts";

/*
 * Navigation: the header (a floating slab of glass with the tabs, search and you), the footer, Zaisma's own
 * scrollbar and a row's arrows. From the header draft (ops docs/drafts/look-and-voice/header.html) and the home draft.
 */

export type HeaderTab = "home" | "your-games" | "developer" | "forum";

export interface HeaderOptions {
  /** The tab of the page you're on, or none (like sign-in). */
  current: HeaderTab | null;
  /** The page's own search; without it the header has none. */
  search?: Omit<SearchFieldOptions, "state">;
  /** The signed-in account, or none: then the header says Sign in. */
  account?: { username: string; pictureMarkup: Raw } | null;
  /** The dashboard and the forum: the Developer and Forum tabs open out of the end of the tabs. */
  isOnDeveloperPage: boolean;
  /** Sign-in's pages: the logo alone, with no tabs and nothing at the end, so nothing leads away from signing in but the logo home. */
  isOnSignInPage?: boolean;
  /** Tabs of the page's own in place of Zaisma's (the admin pages'). */
  ownTabs?: SwitchTab[];
  /** Where Your games is, once its page exists: the tab shows for a signed-in account then. */
  yourGamesHref?: string;
  /** The page shows its own runner (a game's Play, a form's Save), so Sign in is a cut button: one runner in view. */
  hasPageRunner?: boolean;
  /** Fixed slim, as after scrolling: the gallery's state. */
  isCompact?: boolean;
  /** The account menu starts open: the gallery's state. */
  isMenuOpen?: boolean;
  /** On a phone, the search starts open in place of the tabs: the gallery's state. */
  isSearchOpen?: boolean;
  /** Unique on the page, for the menu's id. Defaults to "top". */
  id?: string;
}

const tab = (label: string, href: string, isCurrent: boolean, isFoldable = false, isOpen = true): SwitchTab => ({ label, href, isCurrent, isFoldable, isFolded: isFoldable && !isOpen });

/**
 * The header: a floating slab of glass, cut corners and a drawn rim. Orange only on what you act on. Its tabs show only as a choice, two or
 * more: a lone Home would be a button to where the logo goes already, so then there's no row of tabs (they stay in the page, hidden, so the
 * developer tabs still fold on the way to a developer page).
 */
export function header(options: HeaderOptions): Raw {
  const id = options.id ?? "top";
  const account = options.account ?? null;
  const wordmark = logo("wordmark");
  const isOpen = options.isOnDeveloperPage;
  const menuId = `${id}-menu`;
  const tabs = options.ownTabs ?? [
    tab("Home", "/", options.current === "home"),
    ...(account && options.yourGamesHref ? [tab("Your games", options.yourGamesHref, options.current === "your-games")] : []),
    tab("Developer", account ? "/dashboard" : "/developers", options.current === "developer", true, isOpen),
    tab("Forum", "/forum", options.current === "forum", true, isOpen),
  ];
  const hasTabRow = !options.isOnSignInPage && tabs.filter((each) => !each.isFolded).length >= 2;
  const states = [hasTabRow ? "has-tab-row" : "", options.isCompact ? "is-compact" : "", options.isSearchOpen ? "searching" : ""].filter(Boolean).map((name) => ` ${name}`).join("");
  const signIn = options.hasPageRunner ? cutButton("Sign in", { href: "/signin" }) : runButton("Sign in", { href: "/signin" });
  const menuItems: DropdownItem[] = account
    ? [
        { label: "Your profile", icon: "person", href: `/@${account.username}` },
        { label: "Friends", icon: "friends", href: "/friends" },
        { label: "Developer", icon: "code", href: "/dashboard" },
        { label: "Settings", icon: "gear", href: "/account" },
        { kind: "rule" },
        { label: "Sign out", icon: "sign-out", action: "/signout" },
      ]
    : [];
  return html`<header class="top glass${states}" id="${id}" data-compacts data-glass data-glass-corners="header"${options.isCompact ? raw(" data-stays-compact") : ""}>${EDGE}
  ${wordmark}
  ${options.isOnSignInPage ? "" : html`<nav class="nav" aria-label="Main"${hasTabRow ? "" : raw(" hidden")}>${tabSwitch({ label: "Where you are", switchSize: "big", isFramed: true, tabs })}</nav>`}
  ${options.search ? html`${searchField(options.search)}${cutButton(options.search.label, { type: "button", icon: "search", isLabelHidden: true, isSmall: true, isExpanded: Boolean(options.isSearchOpen) })}` : ""}
  ${options.isOnSignInPage ? "" : html`<div class="end">${
    account ? accountButton({ username: account.username, pictureMarkup: account.pictureMarkup, menuId, isMenuOpen: options.isMenuOpen }) : signIn
  }</div>`}
</header>${account ? dropdown({ id: menuId, label: "Your account", head: { title: account.username, note: "Online" }, items: menuItems, isOpen: options.isMenuOpen }) : ""}`;
}

export interface AccountButtonOptions {
  username: string;
  /** Your picture: a Picture frame (data.ts), cut (isCut) so it fits the header's corner, and online. */
  pictureMarkup: Raw;
  /** The id of the account menu it opens. */
  menuId: string;
  isMenuOpen?: boolean;
  /** The gallery's fixed states: pointed at, pressed, or with keyboard focus. */
  state?: "is-pointed" | "is-pressed" | "is-focused";
}

/**
 * You, signed in: your picture in its frame is the button itself, with no name or arrow beside it (a picture at a header's end reads as you,
 * and as something to press). It opens the account menu, a pane of the same glass, which names you.
 */
export function accountButton(options: AccountButtonOptions): Raw {
  return html`<button type="button" class="me${options.state ? ` ${options.state}` : ""}" aria-expanded="${options.isMenuOpen ? "true" : "false"}" aria-controls="${options.menuId}" aria-label="Your account, ${options.username}">${options.pictureMarkup}</button>`;
}

const HEADER_STYLES = `
/* The header's height at rest, from its size classes, for the page under it to clear (html.ts's --header-room): one row of regular controls
   inside its inset. On a phone its first row is small controls, and the tabs, where there are any, a row of regular height under it. */
:root { --header-height: calc(var(--control-height-regular) + 2 * var(--pad-inner-pane)); }
@media (max-width: 760px) {
  :root { --header-height: calc(var(--control-height-small) + 2 * var(--pad-inner-pane)); }
  :root:has(#top.has-tab-row) { --header-height: calc(var(--control-height-small) + var(--gap-control-stack) + var(--control-height-regular) + 2 * var(--pad-inner-pane)); }
}
/* The header: a floating slab of the sign-in's glass, cut corners and a drawn rim, over the page. Orange only on what you act on.
   It's adaptive glass: --glass-top sets its tint and thickness, and smoked glass (dark, or .smoke) gives it light words. */
.top {
  position: fixed; z-index: 10; top: var(--pad-pane); left: 50%; transform: translateX(-50%);
  width: min(1240px, calc(100% - 2 * var(--pad-pane))); height: var(--header-height);
  display: flex; align-items: center; gap: 0; padding: 0 var(--pad-inner-pane);
  --glass-tint: var(--glass-top);
  clip-path: ${cutPolygon("header")};
  transition: var(--glass-transition), height 0.45s cubic-bezier(.2,.8,.2,1), top 0.45s cubic-bezier(.2,.8,.2,1), transform 0.45s cubic-bezier(.4,0,.2,1);
}
/* Compact, once the page scrolls: its controls are small ones, and it's as tall as they are inside its inset. */
.top.is-compact { height: calc(var(--control-height-small) + 2 * var(--pad-inner-pane)); top: 8px; }
.top > :not(.edge) { position: relative; z-index: 3; }
.top .find, .top .find input, .top .run { transition: height 0.45s cubic-bezier(.2,.8,.2,1), width 0.45s cubic-bezier(.2,.8,.2,1), font-size 0.45s; }
/* Your picture is glass, so its changes start with the glass's. */
.top .frame { transition: var(--glass-transition), height 0.45s cubic-bezier(.2,.8,.2,1), width 0.45s cubic-bezier(.2,.8,.2,1); }
.top.is-compact .nav { --switch-height: var(--control-height-small); }
.top.is-compact :is(.find, .run, .end > .cut-btn) { --control-height: var(--control-height-small); }
.top.is-compact .run { font-size: 15px; }
.top.is-compact .me { --frame: var(--control-height-small); }

/* The header's gap is a row of controls' (their boxes overlap by the slant); the logo is words beside them. */
.top > .logo { margin-right: var(--gap-block-block); }
/* Search beside Sign in is a row of two controls, so they slant toward each other; beside your account's picture it's words beside it. */
.top .find:has(~ .end > .shell) { margin-inline-end: var(--gap-control-row-boxes); }
.top .find:has(~ .end > .me) { margin-inline-end: var(--gap-words-control); }
.top.is-compact .logo { --logo-height: 23px; }

/* Where you are: a framed Switch (inputs.ts), its tabs at their own widths; the header only places it and sets its height as it slims.
   With fewer than two tabs to show it isn't a choice, so it's hidden (header()). */
.nav { display: flex; flex: none; min-width: 0; }
.top .nav[hidden] { display: none; }
.nav > .switch-frame { flex: 1; }

/* Search sits after the tabs, pushed to the end; with neither, the end goes to the end by itself. */
.top .find { margin-left: auto; }
.end { display: flex; align-items: center; flex: none; margin-left: auto; }
.top .find ~ .end { margin-left: 0; }


/* Phones: one slab in two rows: the logo, a search button and you on top; where you are below. */
/* The phone's search button: a small Cut button, icon only, that swaps the tabs for the field. */
.top > .find + .cut-btn { display: none; }
@media (max-width: 760px) {
  /* The header floats on phones too: a slab of glass inset from every edge (below the notch), never touching the screen's sides. */
  /* Two rows at most, at rest or compact: Zaisma, search and you (or Sign in) always share the first, the tabs or the field the second. */
  .top { top: calc(var(--pad-pane) + env(safe-area-inset-top, 0px)); width: calc(100% - 2 * var(--pad-pane)); height: auto; display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto auto; align-items: center; gap: var(--gap-control-stack) 0; padding: var(--pad-inner-pane); }
  /* Where the first row is tight (Sign in on a 320px phone), the logo gives way: it draws smaller in the room left, never pushing the row wider. */
  .top > .logo { grid-area: 1 / 1; min-width: 0; }
  .top > .logo svg { max-width: 100%; }
  .top > .find + .cut-btn { grid-area: 1 / 3; }
  .top > .end { grid-area: 1 / 4; }
  .top .nav, .top .find { grid-area: 2 / 1 / 3 / -1; }
  /* Compact keeps the same inset around the tabs as at rest; only the rows themselves get shorter. */
  .top.is-compact { top: calc(6px + env(safe-area-inset-top, 0px)); height: auto; padding: calc(var(--pad-inner-pane) * 2 / 3); }
  /* Words keep the page's margin from the header's edge, as in a pane: the logo, and the open search field's words (its icon first). */
  .top { --pad-words: calc(var(--pad-pane) - var(--pad-inner-pane)); }
  .top > .logo { margin-left: var(--pad-words); }
  .top .find { --pad-inside-words: var(--pad-words); }
  .top > .logo, .top.is-compact > .logo { --logo-height: 22px; }
  .top .find { display: none; order: 5; flex-basis: 100%; max-width: none; margin: 0; }
  .top.searching .find { display: flex; }
  .top.searching .nav { display: none; }
  .top > .find + .cut-btn { display: inline-flex; margin-left: auto; margin-right: var(--gap-words-control); }
  /* The tabs are a row of regular height: a finger's. */
  .top .nav, .top.is-compact .nav { order: 4; flex-basis: 100%; --switch-height: var(--control-height-regular); }
  /* The first row is small controls, so it shares Zaisma, search and Sign in or you on the narrowest phones; Sign in is the compact runner, or
     a small cut button beside the page's own runner. */
  .top .end > .run-wrap > .run, .top .end > .cut-btn { --control-height: var(--control-height-small); }
  .top .end .run { padding: 0 16px 0 14px; font-size: 14px; gap: 6px; }
  /* The picture is as tall as the search button beside it, at rest or compact. */
  .top .me, .top.is-compact .me { --frame: var(--control-height-small); }
  /* The search button and Sign in are a row of two controls, slanting toward each other; beside your picture, which never slants, it keeps a control's gap. */
  .top > .find + .cut-btn:has(~ .end > .shell) { margin-right: var(--gap-control-row-boxes); }
  .top > .find + .cut-btn:has(~ .end > .me) { margin-right: var(--gap-control-stack); }
}
/* The account menu hangs from your picture's right end, so it's never wider than the room from there back to the page's margin: the
   header's width less its inset (a phone's header is narrower than the menu's own width). */
.top + .dropdown { max-width: calc(100% - 2 * var(--pad-pane) - var(--pad-inner-pane)); }
/* On a touch screen, Sign in and your picture are small, so each takes a regular control's height to press, reaching into the header's inset
   above and below it. */
@media (pointer: coarse) {
  .top .end > .shell::after, .top .end > .me::before { content: ""; position: absolute; left: 0; right: 0; top: min(0px, calc((100% - var(--control-height-regular)) / 2)); bottom: min(0px, calc((100% - var(--control-height-regular)) / 2)); }
}

@media (prefers-reduced-motion: reduce) {
  /* The header's glass still changes as all glass does: only its movement stops. */
  .top { transition: var(--glass-transition); }
}
`;

/**
 * The header's own behavior: it slims once the page scrolls (the gallery's frames scroll a box of their own,
 * [data-scroll-box]), the slab sits under the current page and a faint one follows the pointer, "/" jumps to search,
 * on a phone the search button swaps the tabs for the field, and the developer tabs open or fold from where the last page left them.
 * The menu is DROPDOWN_SCRIPT's.
 */
export const HEADER_SCRIPT = pageScript(
  "header",
  `(function () {
  var phone = function () { return window.innerWidth <= 760; };
  var headers = Array.prototype.slice.call(document.querySelectorAll("header.top"));
  headers.forEach(function (top) {
    /* Once the page scrolls, the slab gets slimmer and everything in it shrinks to fit (COMPACT_SCRIPT, data-compacts). */

    /* Where you are is a framed Switch, which moves its own slab (SWITCH_SCRIPT). */

    /* Search: on a phone the search button swaps the row below for the field. */
    var search = top.querySelector('.find input[type="search"]'), findOpen = top.querySelector(".find + .cut-btn");
    top.openSearch = function () { if (!search) return; top.classList.add("searching"); if (findOpen) findOpen.setAttribute("aria-expanded", "true"); search.focus(); };
    top.closeSearch = function () { top.classList.remove("searching"); if (findOpen) findOpen.setAttribute("aria-expanded", "false"); };
    if (findOpen) findOpen.addEventListener("click", function () { if (top.classList.contains("searching")) top.closeSearch(); else top.openSearch(); });
    if (search) search.addEventListener("blur", function () { if (phone() && !search.value) setTimeout(top.closeSearch, 120); });
  });
  /* Pages are separate loads, so the page's header remembers whether its developer tabs were open (sessionStorage zaisma-nav). The next
     page starts them that way, then opens or folds them to its own, as one header would; with nothing saved it shows its own at once. */
  var page = document.getElementById("top"), foldables = page && !page.closest(".header-frame") ? Array.prototype.slice.call(page.querySelectorAll(".tab-switch > .foldable")) : [];
  if (foldables.length) {
    var isOpenHere = !foldables[0].classList.contains("folded"), saved = null;
    var setOpen = function (isOpen) {
      foldables.forEach(function (tab) {
        tab.classList.toggle("folded", !isOpen);
        if (isOpen) { tab.removeAttribute("tabindex"); tab.removeAttribute("aria-hidden"); } else { tab.setAttribute("tabindex", "-1"); tab.setAttribute("aria-hidden", "true"); }
      });
    };
    try { saved = JSON.parse(sessionStorage.getItem("zaisma-nav") || "null"); } catch (error) {}
    if (saved && saved.isDeveloperOpen === !isOpenHere && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      foldables.forEach(function (tab) { tab.style.transition = "none"; });
      setOpen(saved.isDeveloperOpen); page.offsetWidth;
      foldables.forEach(function (tab) { tab.style.transition = ""; });
      requestAnimationFrame(function () { requestAnimationFrame(function () { setOpen(isOpenHere); }); });
    }
    window.addEventListener("pagehide", function () { try { sessionStorage.setItem("zaisma-nav", JSON.stringify({ isDeveloperOpen: isOpenHere })); } catch (error) {} });
  }
  /* "/" anywhere jumps to the header's search; Escape puts the phone's tabs back. */
  document.addEventListener("keydown", function (event) {
    var top = headers.filter(function (each) { return each.querySelector(".find") && each.offsetParent !== null; })[0];
    if (!top) return;
    if (event.key === "/" && !/^(input|textarea|select)$/i.test(event.target.tagName) && !event.target.isContentEditable) { event.preventDefault(); top.openSearch(); }
    if (event.key === "Escape" && top.classList.contains("searching")) top.closeSearch();
  });
})();
`,
);

/** The links at the foot of every page: what Zaisma is and its rules. */
const FOOTER_LINKS: [string, string][] = [
  ["For game developers", "/dashboard"], ["Forum", "/forum"], ["Source code", "https://github.com/zaisma/zaisma"], ["Content rules", "/legal/content-rules"],
  ["Privacy", "/legal/privacy"], ["Security", "/legal/security"], ["Copyright (DMCA)", "/legal/dmca"], ["Defamation", "/legal/defamation"],
];

export function footer(): Raw {
  return html`<footer class="foot glass" data-glass data-glass-corners="header">${EDGE}
  ${logo("mark")}
  <nav aria-label="More from Zaisma">${FOOTER_LINKS.map(([words, href]) => textLink(words, href, { isQuiet: true }))}</nav>
  <p>Zaisma is open source, under the MIT license.</p>
</footer>`;
}

/**
 * Zaisma's own scrollbar: "page" for the page, "box" for a box that scrolls up and down, "side" for one that scrolls sideways (put it just
 * after that box; a box marked data-side-rail gets one by itself).
 */
export function rail(scrollKind: "box" | "page" | "side"): Raw {
  return railMarkup(scrollKind);
}

/**
 * A scrollbar of Zaisma's own, for a mouse or trackpad: a slim glass thumb on a hairline at the right edge. It wakes
 * while it moves and rests faintly otherwise. Drag the thumb, or press the line to jump; wheel, keys and touch
 * scroll as always, and phones keep their own. It hides itself when there's nothing to scroll.
 * The page's rail has a mark for each part of the page marked data-rail-mark="<its name>" (the home's rows):
 * point at one for its name, click it to go there.
 */
export const RAIL_SCRIPT = `/* rail */(function () {
  // Any box that scrolls up and down gets its rail by itself, so a new component never has to remember one. A box that
  // hides its scrollbar on purpose (scrollbar-width: none) keeps it hidden. A text box or list box gets one too, laid over its own edge.
  document.querySelectorAll("body *").forEach(function (box) {
    var isControl = box.tagName === "TEXTAREA" || (box.tagName === "SELECT" && (box.multiple || box.size > 1));
    if ((/^(SELECT|INPUT)$/.test(box.tagName) && !isControl) || (box.nextElementSibling && box.nextElementSibling.hasAttribute("data-rail"))) return;
    var style = getComputedStyle(box);
    if (!/^(auto|scroll)$/.test(style.overflowY) || style.scrollbarWidth === "none" || box.classList.contains("rail-thumb")) return;
    var parent = box.parentElement; if (!parent || parent === document.body) return;
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    box.insertAdjacentHTML("afterend", '<div class="rail"' + (isControl ? " data-rail-follows" : "") + ' data-rail="box" aria-hidden="true"><div class="rail-line"></div><div class="rail-thumb glass"></div></div>');
  });
  // A box that scrolls sideways and asks for it (data-side-rail: a table, a chart) gets the same rail laid on its side, under it: shown on
  // phones too, whose own sideways scrollbars hide.
  document.querySelectorAll("[data-side-rail]").forEach(function (box) {
    if (box.nextElementSibling && box.nextElementSibling.hasAttribute("data-rail")) return;
    box.insertAdjacentHTML("afterend", '<div class="rail sideways" data-rail="side" aria-hidden="true"><div class="rail-line"></div><div class="rail-thumb glass"></div></div>');
  });
  document.querySelectorAll("[data-rail]").forEach(function (bar) {
    var isPage = bar.getAttribute("data-rail") === "page", isSide = bar.getAttribute("data-rail") === "side", scroller = isPage ? null : bar.previousElementSibling;
    if (!isPage && !scroller) return;
    var line = bar.querySelector(".rail-line"), thumb = bar.querySelector(".rail-thumb");
    if (isPage) document.documentElement.classList.add("own-scroll"); else scroller.classList.add("own-scroll");
    bar.classList.add("is-on");
    // The page's marks: one per marked part, sitting where the thumb's middle will be once that part is at the top.
    var offset = function () { return parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 90; };
    // A box's rail marks the parts inside the box, down it or along it; the page's, those in no box of their own.
    var parts = isPage
      ? Array.prototype.filter.call(document.querySelectorAll("[data-rail-mark]"), function (part) { return !part.closest("[data-rail-marks-own]"); })
      : Array.prototype.filter.call(scroller.querySelectorAll("[data-rail-mark]"), function (part) {
          // A part inside a box of its own in this one (a sideways row in a pane) is that box's rail's to mark.
          var own = part.parentElement.closest("[data-side-rail], [data-rail-marks-own]");
          return !own || own === scroller || !scroller.contains(own);
        });
    if (!isPage && parts.length) scroller.setAttribute("data-rail-marks-own", "");
    // Where a part sits along the box (or the page), from its start, as the box would scroll to show it.
    function spot(part) {
      if (isPage) return part.getBoundingClientRect().top + window.scrollY - offset();
      var box = scroller.getBoundingClientRect(), r = part.getBoundingClientRect();
      return isSide ? r.left - box.left + scroller.scrollLeft : r.top - box.top + scroller.scrollTop;
    }
    var marks = parts.map(function (part) {
      var mark = document.createElement("button"), name = document.createElement("span");
      mark.type = "button"; mark.className = "rail-mark"; mark.tabIndex = -1; name.className = "tag glass"; name.textContent = part.getAttribute("data-rail-mark");
      mark.appendChild(name); bar.appendChild(mark);
      mark.addEventListener("click", function () {
        var behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        if (isPage) window.scrollTo({ top: spot(part), behavior: behavior }); else scroller.scrollTo(isSide ? { left: spot(part), behavior: behavior } : { top: spot(part), behavior: behavior });
      });
      return { part: part, mark: mark, name: name };
    });
    // Names whose marks sit close would lie over each other: each keeps at least its own size (and a gap) from the last, along the rail,
    // pulled back in where the last would run past the rail's end. --label-shift moves a name from its mark.
    var LABEL_GAP_PX = 4;
    function spread(track) {
      // Sideways, only one name shows at a time (the nearest, below): each sits over its own mark, kept inside the rail's ends.
      if (isSide) {
        marks.forEach(function (m) {
          if (m.mark.hidden) return;
          var at = parseFloat(m.mark.style.left) || 0, half = m.name.offsetWidth / 2, center = Math.max(half, Math.min(track - half, at));
          m.name.style.setProperty("--label-shift", (center - at).toFixed(1) + "px");
        });
        return;
      }
      var placed = marks.filter(function (m) { return !m.mark.hidden; }).map(function (m) {
        return { m: m, at: parseFloat(m.mark.style[isSide ? "left" : "top"]) || 0, size: isSide ? m.name.offsetWidth : m.name.offsetHeight };
      }).sort(function (one, other) { return one.at - other.at; });
      placed.forEach(function (p, i) { p.center = i ? Math.max(p.at, placed[i - 1].center + (placed[i - 1].size + p.size) / 2 + LABEL_GAP_PX) : p.at; });
      for (var i = placed.length - 1; i >= 0; i--) {
        var p = placed[i], most = i === placed.length - 1 ? Math.max(p.at, track - p.size / 2) : placed[i + 1].center - (placed[i + 1].size + p.size) / 2 - LABEL_GAP_PX;
        if (p.center > most) p.center = most;
      }
      // …and never before the rail's start: where they can't all fit, the last ones run past its end instead.
      placed.forEach(function (p, i) { var least = i ? placed[i - 1].center + (placed[i - 1].size + p.size) / 2 + LABEL_GAP_PX : Math.min(p.at, p.size / 2); if (p.center < least) p.center = least; });
      placed.forEach(function (p) { p.m.name.style.setProperty("--label-shift", (p.center - p.at).toFixed(1) + "px"); });
    }
    // Sideways, everything below runs along x instead of y: the box's left edge, its width, the pointer's x.
    function at() { return isPage ? window.scrollY : isSide ? scroller.scrollLeft : scroller.scrollTop; }
    function to(y) { if (isPage) window.scrollTo(0, y); else if (isSide) scroller.scrollLeft = y; else scroller.scrollTop = y; }
    function along(event) { return isSide ? event.clientX : event.clientY; }
    var size = { track: 0, thumb: 0, max: 1 };
    // The page's rail starts the gutter's width below the page's floating bar (data-rail-starts-below), following it as it tightens.
    var above = isPage ? document.querySelector("[data-rail-starts-below]") : null, GUTTER_PX = 10;
    function layout() {
      if (above) bar.style.top = Math.round(above.getBoundingClientRect().bottom + GUTTER_PX) + "px";
      // A text box isn't a glass pane with room around it: the rail is laid along the box's own right edge.
      if (bar.hasAttribute("data-rail-follows")) {
        bar.style.top = scroller.offsetTop + 8 + "px"; bar.style.bottom = "auto"; bar.style.height = Math.max(0, scroller.offsetHeight - 16) + "px";
        bar.style.right = "auto"; bar.style.left = scroller.offsetLeft + scroller.offsetWidth - 22 + "px";
      }
      var whole = isPage ? document.documentElement.scrollHeight : isSide ? scroller.scrollWidth : scroller.scrollHeight, view = isPage ? window.innerHeight : isSide ? scroller.clientWidth : scroller.clientHeight, max = whole - view;
      bar.hidden = max <= 4; if (bar.hidden) return;
      var track = isSide ? bar.clientWidth : bar.clientHeight, height = Math.max(36, Math.round(track * view / whole));
      size = { track: track, thumb: height, max: max };
      thumb.style[isSide ? "width" : "height"] = height + "px";
      move();
      marks.forEach(function (m) {
        var shown = Boolean(m.part.offsetParent); m.mark.hidden = !shown; if (!shown) return;
        var top = Math.max(0, Math.min(max, spot(m.part)));
        m.mark.style[isSide ? "left" : "top"] = ((track - height) * top / max + height / 2).toFixed(1) + "px";
      });
      spread(track);
    }
    // Scrolling only moves the thumb: the rail's size and its marks change only with the page's size (layout, above), so a scroll
    // never reads the page's layout.
    function move() { if (!bar.hidden) thumb.style.transform = (isSide ? "translateX(" : "translateY(") + ((size.track - size.thumb) * Math.min(1, at() / size.max)).toFixed(1) + "px)"; }
    var sleep = 0, queued = false;
    function wake() { bar.classList.add("awake"); clearTimeout(sleep); sleep = setTimeout(function () { bar.classList.remove("awake"); }, 1100); }
    (isPage ? window : scroller).addEventListener("scroll", function () { wake(); if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; move(); }); }, { passive: true });
    window.zaismaWatch.resize(layout);
    window.zaismaWatch.size(isPage ? document.body : scroller.firstElementChild || scroller, layout); if (above) window.zaismaWatch.size(above, layout);
    // A box's content can change without its first child changing size (a pane's views taking turns, a step showing): measured again then.
    if (!isPage) window.zaismaWatch.page(function (changes) { if (changes.some(function (change) { return scroller.contains(change.target); })) layout(); });
    var drag = null;
    function start(event, jump) {
      event.preventDefault();
      if (jump) { var y = along(event) - (isSide ? bar.getBoundingClientRect().left : bar.getBoundingClientRect().top) - size.thumb / 2; to(Math.max(0, Math.min(1, y / (size.track - size.thumb))) * size.max); }
      drag = { y: along(event), from: at() }; bar.classList.add("dragging");
      try { bar.setPointerCapture(event.pointerId); } catch (error) {}
    }
    thumb.addEventListener("pointerdown", function (event) { start(event, false); });
    line.addEventListener("pointerdown", function (event) { start(event, true); });
    bar.addEventListener("pointermove", function (event) { if (drag) to(drag.from + (along(event) - drag.y) * size.max / Math.max(1, size.track - size.thumb)); });
    function end() { drag = null; bar.classList.remove("dragging"); }
    // Sideways, the name shown is the mark's nearest the pointer, or the thumb's middle while dragging.
    function near(event) {
      if (!isSide || !marks.length) return;
      var spotPx = drag ? (size.track - size.thumb) * Math.min(1, at() / size.max) + size.thumb / 2 : event.clientX - bar.getBoundingClientRect().left, best = null, gap = Infinity;
      marks.forEach(function (m) { if (m.mark.hidden) return; var away = Math.abs(parseFloat(m.mark.style.left) - spotPx); if (away < gap) { gap = away; best = m; } });
      marks.forEach(function (m) { m.mark.classList.toggle("is-near", m === best); });
    }
    function farAway() { marks.forEach(function (m) { m.mark.classList.remove("is-near"); }); }
    bar.addEventListener("pointermove", near);
    bar.addEventListener("pointerdown", near);
    bar.addEventListener("pointerleave", function () { if (!drag) farAway(); });
    // By touch, letting go of the thumb near a mark goes to its part, as a click on the mark does with a mouse.
    var SNAP_PX = 18;
    function release(event) {
      var wasDragging = Boolean(drag); end();
      if (event.pointerType !== "mouse") farAway();
      if (!wasDragging || event.pointerType === "mouse" || !marks.length) return;
      var middle = (size.track - size.thumb) * Math.min(1, at() / size.max) + size.thumb / 2, nearest = null, gap = SNAP_PX;
      marks.forEach(function (m) { if (m.mark.hidden) return; var away = Math.abs(parseFloat(m.mark.style[isSide ? "left" : "top"]) - middle); if (away <= gap) { gap = away; nearest = m; } });
      if (nearest) nearest.mark.click();
    }
    bar.addEventListener("pointerup", release); bar.addEventListener("pointercancel", end);
    layout(); wake();
  });
})();
`;


export interface RowArrowsOptions {
  /** The row's name, for a screen reader: "Scroll Popular on". */
  rowName: string;
  /** The id of the track it scrolls (Track, layout.ts). */
  trackId: string;
  /** Where the row starts scrolled to, so both arrows or only the back one can be pressed: the gallery's fixed states. */
  scrolledTo?: "middle" | "end";
}

/** Arrows to scroll a row, for a mouse or trackpad: a cut well of two halves at the right of the row's heading. Touch screens swipe instead. */
export function rowArrows(options: RowArrowsOptions): ControlMarkup {
  const arrow = (way: "back" | "on") =>
    cutButton(`Scroll ${options.rowName} ${way}`, { type: "button", icon: way === "back" ? "arrow-back" : "arrow-on", isLabelHidden: true, isInWell: true, controls: options.trackId });
  return controlMarkup(html`<div class="steps cut-carved" data-row-arrows${options.scrolledTo ? html` data-scrolled-to="${options.scrolledTo}"` : ""} data-cut-line="9">${CUT_LINE}${arrow("back")}${arrow("on")}</div>`, "small", { isPointerOnly: true });
}

/**
 * Scroll fades: every box that scrolls up and down, wherever it is and whatever is in it, fades its words out over its
 * top and bottom edges while there's more to scroll that way, so nothing runs hard into the edge of its pane. Found by
 * itself, like the rail, on every device; a stand-in page under a header example (data-scroll-box), a box with a fade of its own
 * (data-own-fade, a birthday wheel) and form fields are left alone.
 */
export const SCROLL_FADE_SCRIPT = `/* scroll fades */(function () {
  var FADE_PX = 28, boxes = [];
  function sync(box) {
    var top = Math.min(FADE_PX, box.scrollTop), bottom = Math.min(FADE_PX, box.scrollHeight - box.clientHeight - box.scrollTop);
    box.style.setProperty("--fade-top", Math.max(0, top) + "px"); box.style.setProperty("--fade-bottom", Math.max(0, bottom) + "px");
    // Masked only while there's something to fade: a mask on a box that doesn't scroll would only cost its repaints.
    box.classList.toggle("is-fading", box.scrollHeight > box.clientHeight + 1);
    held(box);
  }
  // A box keeps a swipe or a wheel to itself only while it can scroll; one that can't lets it carry on to the page.
  function held(box) { box.classList.toggle("is-scrollable", box.scrollHeight > box.clientHeight + 1); }
  function find() {
    // Boxes that scroll with no fade of their own (a header example's stand-in page, a table) still hold a swipe only while they can scroll.
    document.querySelectorAll("[data-scroll-box]").forEach(function (box) {
      held(box);
      window.zaismaWatch.size(box.firstElementChild || box, function () { held(box); });
    });
    document.querySelectorAll("body *").forEach(function (box) {
      if (box.classList.contains("scroll-fades") || /^(TEXTAREA|SELECT|INPUT)$/.test(box.tagName) || box.hasAttribute("data-scroll-box") || box.hasAttribute("data-own-fade")) return;
      if (!/^(auto|scroll)$/.test(getComputedStyle(box).overflowY)) return;
      box.classList.add("scroll-fades"); boxes.push(box); sync(box);
      var queued = false;
      box.addEventListener("scroll", function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; sync(box); }); }, { passive: true });
      window.zaismaWatch.size(box, function () { sync(box); });
    });
  }
  find();
  window.zaismaWatch.resize(function () { boxes.forEach(sync); });
  // Rows that scroll sideways fade over a side with more past it, and start where the one you're on shows whole.
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("[data-fades-sideways]").forEach(function (row) {
    // What's shown in it: a tab, a cover. A folded tab, or a switch's slab, ghost and ring, never counts, so a row whose box only rounds a
    // few pixels wider than what it shows (a phone's emulator) never fades.
    function shown() {
      return Array.prototype.filter.call(row.querySelectorAll(":scope > *, :scope > * > *"), function (el) {
        if (el.classList.contains("folded") || el.hasAttribute("aria-hidden") || el.children.length && el.parentElement === row && el.querySelector(":scope > a, :scope > button, :scope > .cover")) return false;
        return el.getBoundingClientRect().width >= 1 && !/^(absolute|fixed)$/.test(getComputedStyle(el).position);
      });
    }
    // More that way is something shown running past that edge.
    function shownSpan() {
      var box = row.getBoundingClientRect(), left = Infinity, right = -Infinity;
      shown().forEach(function (el) { var r = el.getBoundingClientRect(); left = Math.min(left, r.left); right = Math.max(right, r.right); });
      return left === Infinity ? { before: 0, after: 0 } : { before: box.left - left, after: right - box.right };
    }
    function fades() { var span = shownSpan(); row.classList.toggle("more-left", span.before > 2); row.classList.toggle("more-right", span.after > 2); return span; }
    // It starts where the one you're on shows whole, once it's laid out (a gallery section off screen isn't yet), and again once the fonts are in.
    var here = row.querySelector('[aria-current="page"], [aria-pressed="true"]'), isStarted = false;
    function start() { if (here && !isStarted && row.scrollWidth - row.clientWidth > 1) { isStarted = true; row.showWhole(here, false); } }
    function ends() { start(); var span = fades(); row.classList.toggle("is-scrollable-sideways", span.before + span.after > 2); }
    // Where something sits along the row's whole scrolled content.
    function along(el) { var r = el.getBoundingClientRect(), start = r.left - row.getBoundingClientRect().left + row.scrollLeft; return { start: start, end: start + r.width }; }
    // Scrolls the least that shows something whole, clear of the fades: back to just past the fade at the start (the row's scroll padding
    // there, which a framed switch sets to its fade at that side and snaps by), or on to the first stop, a shown thing's start, from which
    // it's whole clear of the fade at the end (--fade-sideways-px). isGliding scrolls smoothly; a smooth scroll can be cut short (a touch
    // still settling, the page scrolling too), so it lands once it's over.
    row.showWhole = function (el, isGliding) {
      var css = getComputedStyle(row), most = row.scrollWidth - row.clientWidth, now = row.scrollLeft, at = along(el);
      var fadePx = parseFloat(css.scrollPaddingLeft) || 0, endFadePx = parseFloat(css.getPropertyValue("--fade-sideways-px")) || fadePx;
      if (most <= 1) return;
      // At the row's very start or end there's no fade on that side.
      var fadeAfter = function (scrollPx) { return scrollPx < most - 1 ? endFadePx : 0; }, goal = now;
      if (at.start < now + (now > 1 ? fadePx : 0)) goal = at.start - fadePx;
      else if (at.end > now + row.clientWidth - fadeAfter(now)) {
        goal = at.start - fadePx;
        shown().some(function (stop) {
          var scrollPx = Math.max(0, Math.min(most, along(stop).start - fadePx));
          if (scrollPx > now && at.end <= scrollPx + row.clientWidth - fadeAfter(scrollPx)) { goal = scrollPx; return true; }
          return false;
        });
      }
      goal = Math.max(0, Math.min(most, goal));
      if (Math.abs(goal - now) < 1) return;
      if (!isGliding || reduce) { row.scrollLeft = goal; return; }
      row.scrollTo({ left: goal, behavior: "smooth" });
      clearTimeout(row.settleTimer); row.settleTimer = setTimeout(function () { if (Math.abs(row.scrollLeft - goal) > 1) row.scrollTo({ left: goal, behavior: "smooth" }); }, 450);
    };
    if (here && document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (isStarted) row.showWhole(here, false); });
    row.addEventListener("scroll", fades, { passive: true });
    window.zaismaWatch.size(row, ends); if (row.firstElementChild) window.zaismaWatch.size(row.firstElementChild, ends);
    ends();
  });
})();
`;

/**
 * A bar that slims once the page scrolls ([data-compacts]: the header, the gallery's bar): it turns compact past COMPACT_AT_PX and
 * roomy again only at the very top, so it can't flip back and forth. The page is never scrolled for you: near the top it stays where you
 * left it. A bar over a stand-in page (the gallery's header examples) follows that page's box, [data-scroll-box]; data-stays-compact
 * keeps it compact.
 */
export const COMPACT_SCRIPT = `/* compact bars */(function () {
  var COMPACT_AT_PX = 24;
  document.querySelectorAll("[data-compacts]").forEach(function (bar) {
    if (bar.hasAttribute("data-stays-compact")) { bar.classList.add("is-compact"); return; }
    // A bar follows the box that scrolls right beside it (a header example's stand-in page), or else the page: never a box deeper in, like a table.
    var box = bar.parentElement && bar.parentElement.querySelector(":scope > [data-scroll-box]"), scroller = box || window;
    function at() { return box ? box.scrollTop : window.scrollY; }
    function sync() { var y = at(); if (y > COMPACT_AT_PX) bar.classList.add("is-compact"); else if (y <= 0) bar.classList.remove("is-compact"); }
    scroller.addEventListener("scroll", sync, { passive: true });
    sync();
  });
})();
`;

/** A row's arrows scroll it by most of its width, lie flat at its ends, and hide when there's nothing to scroll; the row fades on a side with more (data-fades-sideways). */
export const ROW_SCRIPT = `/* rows */(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("[data-row-arrows]").forEach(function (steps) {
    var arrows = steps.querySelectorAll(".cut-btn"), back = arrows[0], on = arrows[1], track = document.getElementById(back.getAttribute("aria-controls"));
    if (!track) return;
    // The gallery's fixed states: the row starts scrolled to its middle or its end, once it's laid out (a section off screen isn't yet).
    var scrolledTo = steps.getAttribute("data-scrolled-to");
    function ends() {
      var more = track.scrollWidth - track.clientWidth;
      if (scrolledTo && more > 2) { track.scrollLeft = scrolledTo === "end" ? more : more / 2; scrolledTo = null; }
      var left = track.scrollLeft > 2, right = track.scrollLeft < more - 2;
      back.disabled = !left; on.disabled = !right; steps.hidden = more <= 2;
    }
    function by(direction) { track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" }); }
    back.addEventListener("click", function () { by(-1); }); on.addEventListener("click", function () { by(1); });
    track.addEventListener("scroll", ends, { passive: true });
    window.zaismaWatch.size(track, ends);
    ends();
  });
})();
`;

const standInPage = html`<div class="stand-in-page">${["Continue playing", "Popular", "New"].map((rowName, rowIndex) => html`<section><h3>${rowName}</h3><div class="stand-in-row">${Object.values(STAND_IN_COVERS).slice(rowIndex * 2, rowIndex * 2 + 4)}</div></section>`)}</div>`;
/** A header example: a small page of its own, cut like a pane, with the backdrop behind it and a stand-in page scrolling under the header (fixed things stay in the frame). */
const headerFrame = (markup: Raw, isTall = false) => html`<div class="header-frame${isTall ? " tall" : ""}"><div class="backdrop is-framed" aria-hidden="true"></div>${markup}<div class="header-scroll" data-scroll-box>${standInPage}</div></div>`;
/** A footer example: a small page of its own, cut like a pane, with the backdrop behind it, as the header's are. */
const pageFrame = (markup: Raw) => html`<div class="header-frame"><div class="backdrop is-framed" aria-hidden="true"></div><div class="header-scroll" data-scroll-box>${markup}</div></div>`;
const STAND_IN_ACCOUNT = { username: "emma_r", pictureMarkup: pictureFrame("emma_r", "md", { presence: "online", isCut: true }) };
const LONG_NAMED_ACCOUNT = { username: "maximilian_vandenberg", pictureMarkup: pictureFrame("maximilian_vandenberg", "md", { presence: "online", isCut: true }) };
const GAMES_SEARCH = { action: "#header", name: "search_text", searchText: "", placeholder: "Search games", label: "Search games" };

component({
  name: "Header",
  slug: "header",
  group: "navigation",
  summary: "The top of every page: Zaisma, where you are, search when the page has one, and you. It floats as glass and slims once the page scrolls.",
  styles: HEADER_STYLES,
  render: header,
  examples: [
    { label: "Try it: scroll the page under it, point at its tabs, open the menu", isWide: true, markup: headerFrame(header({ id: "example-top-try", current: "home", search: GAMES_SEARCH, account: STAND_IN_ACCOUNT, isOnDeveloperPage: false, yourGamesHref: "#header" }), true) },
    { label: "Signed out, on Home: no tabs, since Home alone isn't a choice", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-out", current: "home", search: GAMES_SEARCH, account: null, isOnDeveloperPage: false })) },
    { label: "Signed out, on a page with its own runner (a game's Play): Sign in is a cut button", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-runner", current: "home", search: GAMES_SEARCH, account: null, isOnDeveloperPage: false, hasPageRunner: true })) },
    { label: "Signed in, menu open", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-in", current: "home", search: GAMES_SEARCH, account: STAND_IN_ACCOUNT, isOnDeveloperPage: false, isMenuOpen: true, yourGamesHref: "#header" }), true) },
    { label: "A long username, menu open", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-long", current: "home", search: GAMES_SEARCH, account: LONG_NAMED_ACCOUNT, isOnDeveloperPage: false, isMenuOpen: true, yourGamesHref: "#header" }), true) },
    { label: "On the dashboard", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-dev", current: "developer", account: STAND_IN_ACCOUNT, isOnDeveloperPage: true, yourGamesHref: "#header" })) },
    { label: "Search open (on a phone it takes the tabs' place)", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-search", current: "home", search: { ...GAMES_SEARCH, searchText: "Ashen Crown" }, account: STAND_IN_ACCOUNT, isOnDeveloperPage: false, yourGamesHref: "#header", isSearchOpen: true })) },
    { label: "Compact, after scrolling", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-compact", current: "home", search: GAMES_SEARCH, account: STAND_IN_ACCOUNT, isOnDeveloperPage: false, isCompact: true, yourGamesHref: "#header" })) },
    { label: "Compact and signed out", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-compact-out", current: "home", search: GAMES_SEARCH, account: null, isOnDeveloperPage: false, isCompact: true })) },
    { label: "On sign-in", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-sign-in", current: null, isOnDeveloperPage: false, isOnSignInPage: true })) },
  ],
});

component({
  name: "Account button",
  slug: "account-button",
  group: "navigation",
  summary: "You, at the header's end once you're signed in: your picture alone is the button, online, as tall as the controls beside it. It opens the account menu, which names you.",
  styles: `
/* Your picture in its frame, as tall as the controls beside it and cut by the edge rule like them (Picture frame's isCut), so it fits the
   header's corner. Pointing brightens it, pressing sinks it a little, and with the menu open or by keyboard the focus line runs round it
   inside its cut, as on every control. Online, its green line runs inside the frame's foot, so nothing sits outside the button to crowd the
   header's edge or what's below it. */
.me { --frame: var(--control-height-regular); position: relative; display: flex; padding: 0; border: 0; background: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.me .frame { --frame: inherit; transition: var(--glass-transition), width 0.45s cubic-bezier(.2,.8,.2,1), height 0.45s cubic-bezier(.2,.8,.2,1), scale 0.15s; }
.me .frame-picture { transition: filter 0.2s; }
.me:hover .frame-picture, .me.is-pointed .frame-picture, .me[aria-expanded="true"] .frame-picture { filter: brightness(1.1); }
.me:active .frame, .me.is-pressed .frame { scale: 0.95; }
.me:focus-visible { outline: none; }
/* The focus line, as on a glass button: the frame's drawn rim, whole, its hairline in the focus color as wide as every control's focus line
   (half of it shows inside the cut), and the pale parts of the rim that lie over it (its band, glint, facets, fringe) put away. */
.me:focus-visible .frame > .edge, .me.is-focused .frame > .edge, .me[aria-expanded="true"] .frame > .edge { opacity: 1; }
.me:focus-visible .frame > .edge .hair, .me.is-focused .frame > .edge .hair, .me[aria-expanded="true"] .frame > .edge .hair { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.me:focus-visible .frame > .edge :is(.rim-band, .spec-line, .facet, .fringe, .inner), .me.is-focused .frame > .edge :is(.rim-band, .spec-line, .facet, .fringe, .inner), .me[aria-expanded="true"] .frame > .edge :is(.rim-band, .spec-line, .facet, .fringe, .inner) { opacity: 0; }
`,
  render: accountButton,
  examples: [
    { label: "Rest", markup: accountButton({ ...STAND_IN_ACCOUNT, menuId: "example-me-menu" }) },
    { label: "Pointed", markup: accountButton({ ...STAND_IN_ACCOUNT, menuId: "example-me-menu", state: "is-pointed" }), isStill: true },
    { label: "Pressed", markup: accountButton({ ...STAND_IN_ACCOUNT, menuId: "example-me-menu", state: "is-pressed" }), isStill: true },
    { label: "Menu open", markup: accountButton({ ...STAND_IN_ACCOUNT, menuId: "example-me-menu", isMenuOpen: true }), isStill: true },
    { label: "Keyboard focus", markup: accountButton({ ...STAND_IN_ACCOUNT, menuId: "example-me-menu", state: "is-focused" }), isStill: true },
  ],
});

component({
  name: "Footer",
  slug: "footer",
  group: "navigation",
  summary: "The end of every page: for game developers, the forum, the source and the rules.",
  styles: `
/* The foot, at the end of the page. */
/* The footer: a slab of the header's glass across the bottom of the page, where the page ends, never floating over it. */
.foot {
  position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-block-block);
  width: min(1240px, calc(100% - 2 * var(--pad-pane))); margin: var(--gap-block-block) auto var(--pad-pane); padding: var(--pad-inner-pane);
  color: var(--muted); font: var(--type-note); --glass-tint: var(--glass-top);
  clip-path: ${cutPolygon("header")};
  transition: var(--glass-transition);
}
.foot > :not(.edge) { position: relative; z-index: 3; }
/* Quiet links in a row read as one sentence at a word's gap, so each sits a block's gap apart: a list of places, not a line of words. Each
   link is whole on its line (its words never wrap), and the row wraps between links. */
.foot nav { display: flex; flex-wrap: wrap; gap: var(--gap-words-words) var(--gap-block-block); white-space: nowrap; }
.foot p { margin: 0 0 0 auto; }
/* On a phone it stacks, centered: the mark, the links on centered lines as many as fit, then the license. */
@media (max-width: 760px) {
  .foot { flex-direction: column; align-items: center; padding: var(--pad-pane); text-align: center; }
  .foot nav { justify-content: center; width: 100%; }
  .foot p { margin: 0; }
}
`,
  render: footer,
  examples: [{ label: "At the end of a page, on its backdrop", isWide: true, markup: html`<div class="header-frame is-fitted"><div class="backdrop is-framed" aria-hidden="true"></div>${footer()}</div>` }],
});

component({
  name: "Rail",
  slug: "rail",
  group: "navigation",
  summary: "Zaisma's own scrollbar, on every device: it rests faintly and wakes while things move. On a touch screen its thumb is a little wider and drags with a finger.",
  styles: `
/* Zaisma's own scrollbar, on every device: a hairline with a slim glass thumb that wakes while it moves.
   In a box it runs down the inside of the box's right edge; for the page, down the page's right gutter; sideways, under the box. */
.own-scroll { scrollbar-width: none; }
.own-scroll::-webkit-scrollbar { display: none; }
.rail { display: none; position: absolute; z-index: 6; right: 8px; top: 30px; bottom: 30px; width: 14px; opacity: 0.6; transition: opacity 0.35s; }
.rail.is-on { display: block; }
.glass > .rail { position: absolute; z-index: 6; }
.rail[data-rail="page"] { position: fixed; z-index: 12; right: 0; top: 90px; bottom: 14px; }
.rail[hidden] { display: none; }
.rail.awake, .rail:hover, .rail.dragging { opacity: 1; }
.rail-line { position: absolute; inset: 0; cursor: pointer; background: linear-gradient(90deg, transparent 6px, var(--rail-line) 6px, var(--rail-line) 7px, transparent 7px); }
.rail-thumb { position: absolute; top: 0; left: 4px; width: 5px; cursor: grab; --glass-tint: var(--rail-thumb); box-shadow: inset 1px 0 0 var(--rail-edge), 0 2px 6px rgba(10,20,40,0.18);
  clip-path: polygon(0 4px, 4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%);
  transition: var(--glass-transition), left 0.2s, width 0.2s; }
.rail:hover .rail-thumb, .rail.dragging .rail-thumb { left: 2px; width: 9px; clip-path: polygon(0 5px, 5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%); }
.rail.dragging .rail-thumb { cursor: grabbing; box-shadow: inset 2px 0 0 var(--run), 0 2px 8px rgba(10,20,40,0.22); }
/* Sideways (a table, a chart): the same rail laid on its side, under the box. */
.rail.sideways { position: relative; inset: auto; width: auto; height: 14px; user-select: none; -webkit-user-select: none; }
.rail.sideways .rail-line { background: linear-gradient(180deg, transparent 6px, var(--rail-line) 6px, var(--rail-line) 7px, transparent 7px); }
.rail.sideways .rail-thumb { top: 4px; left: 0; width: auto; height: 5px; box-shadow: inset 0 1px 0 var(--rail-edge), 0 2px 6px rgba(10,20,40,0.18); transition: var(--glass-transition), top 0.2s, height 0.2s; }
.rail.sideways:hover .rail-thumb, .rail.sideways.dragging .rail-thumb { top: 2px; left: 0; width: auto; height: 9px; }
.rail.sideways.dragging .rail-thumb { box-shadow: inset 0 2px 0 var(--run), 0 2px 8px rgba(10,20,40,0.22); }
/* A mark per part of the page: a short tick on the line that turns orange when pointed at. Pointing anywhere on the rail opens every mark's name on a small glass label to its left. */
/* Its click area is far bigger than the tick: 24px tall and reaching in over the page, so a mark is easy to hit. */
.rail-mark { position: absolute; left: -12px; width: 26px; height: 24px; margin-top: -12px; padding: 0; border: 0; cursor: pointer; background: none; }
.rail-mark::before { content: ""; position: absolute; left: 15px; right: 2px; top: 11px; height: 2px; --face-color: var(--rail-mark); background: var(--face-color); transition: --face-color 0.2s, left 0.2s; }
.rail-mark:hover::before { --face-color: var(--run); left: 9px; }
.rail-mark[hidden] { display: none; }
/* Its name is a Tag on glass (data.ts), wiped open from the rail. */
.rail-mark span { position: absolute; right: 28px; top: 50%; transform: translate(0, calc(-50% + var(--label-shift, 0px))); pointer-events: none;
  clip-path: polygon(100% 0, 100% 0, calc(100% - 5px) 100%, calc(100% - 5px) 100%); visibility: hidden;
  transition: var(--glass-transition), clip-path 0.18s ease-out, visibility 0s 0.18s; }
/* A label opens by wiping out from the rail, never by fading: a fading blur draws without its glass and turns solid at the end. */
/* Closed, a label is hidden as well as wiped shut, so its glass isn't drawn under the page's scrolling while nobody can see it. */
.rail:hover .rail-mark span, .rail.dragging .rail-mark span { clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); visibility: visible; transition: var(--glass-transition), clip-path 0.18s ease-out, visibility 0s; }
/* In a box, the words under a label are close by and a pane's glass can't blur them again, so its glass is denser. */
.rail:not([data-rail="page"]) .rail-mark span { --glass-tint: var(--table-row-head); }
/* Along a sideways rail, a mark is a short upright tick across the line, and its name opens above it, wiped up from the rail. */
.rail.sideways .rail-mark { left: auto; top: -10px; width: 24px; height: 26px; margin: 0 0 0 -12px; }
/* Its tick crosses the line as a down rail's does (3px to 12px across the rail), reaching further toward the box when pointed at. */
.rail.sideways .rail-mark::before { left: 11px; right: auto; top: 13px; bottom: 4px; width: 2px; height: auto; transition: --face-color 0.2s, top 0.2s; }
.rail.sideways .rail-mark:hover::before { left: 11px; top: 7px; }
.rail.sideways .rail-mark span { right: auto; top: auto; left: 50%; bottom: 26px; transform: translateX(calc(-50% + var(--label-shift, 0px)));
  clip-path: polygon(0 100%, 100% 100%, 100% 100%, 0 100%); }
.rail.sideways:hover .rail-mark span, .rail.sideways.dragging .rail-mark span { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }
/* A sideways rail has room for one name at a time: the nearest mark's (is-near); the rest stay shut. */
.rail.sideways .rail-mark:not(.is-near) span { clip-path: polygon(0 100%, 100% 100%, 100% 100%, 0 100%); visibility: hidden;
  transition: var(--glass-transition), clip-path 0.18s ease-out, visibility 0s 0.18s; }
/* In the narrow layout (a phone, or a small window), the page's bar fits in the gutter beside the glass, centered in it, clear of the
   screen's edge, and starts below the header. */
@media (max-width: 760px) {
  .rail[data-rail="page"] { width: 10px; right: calc((var(--pad-pane) - 10px) / 2); top: 132px; bottom: 10px; }
  .rail[data-rail="page"] .rail-line { background: linear-gradient(90deg, transparent 4.5px, var(--rail-line) 4.5px, var(--rail-line) 5.5px, transparent 5.5px); }
  .rail[data-rail="page"] .rail-thumb { left: 3px; width: 4px; clip-path: polygon(0 3px, 3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%); }
  .rail[data-rail="page"]:hover .rail-thumb, .rail[data-rail="page"].dragging .rail-thumb { left: 2px; width: 6px; clip-path: polygon(0 4px, 4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%); }
  /* …its marks' ticks across that slimmer line. */
  .rail[data-rail="page"] .rail-mark { left: -14px; width: 24px; }
  .rail[data-rail="page"] .rail-mark::before { left: 16px; right: 0; }
  .rail[data-rail="page"] .rail-mark:hover::before { left: 12px; }
}
/* On a touch screen nothing widens it on hover, so its thumb is a little wider from the start (still centered on its line), and a finger on it drags the thumb instead of the page. */
@media (hover: none), (pointer: coarse) {
  .rail { touch-action: none; }
  .rail .rail-thumb { left: 3px; width: 7px; clip-path: polygon(0 4px, 4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%); }
  .rail.sideways .rail-thumb { left: 0; top: 3px; width: auto; height: 7px; }
}
/* By touch, a mark is only a faint tick: a tap or a drag lands on the rail itself (letting go near a tick goes to its part), and the marks'
   names and full ticks show only while a finger drags the thumb, wiping open and shut with the drag, never on a tap's leftover hover. */
@media (hover: none) {
  .rail .rail-mark { pointer-events: none; }
  .rail:not(.dragging) .rail-mark::before { opacity: 0.4; }
  .rail:not(.dragging) .rail-mark span { clip-path: polygon(100% 0, 100% 0, calc(100% - 5px) 100%, calc(100% - 5px) 100%); visibility: hidden;
    transition: var(--glass-transition), clip-path 0.18s ease-out, visibility 0s 0.18s; }
  .rail.sideways:not(.dragging) .rail-mark span { clip-path: polygon(0 100%, 100% 100%, 100% 100%, 0 100%); }
}
@media (hover: none) and (max-width: 760px), (pointer: coarse) and (max-width: 760px) {
  .rail[data-rail="page"] .rail-thumb { left: 2px; width: 6px; }
}
`,
  render: rail,
  examples: [
    {
      label: "Down a box",
      markup: html`<div class="rail-box">${glassPane({ paneWidth: "fit", body: html`<p>${"Wander a forest that grows around you. No combat and no timers: climbing, finding and listening. ".repeat(14)}</p>` })}</div>`,
    },
    {
      label: "Sideways, under a box (a table, a chart)",
      markup: glassPane({ paneWidth: "fit", body: html`<div class="rail-side-box" data-fades-sideways data-side-rail><p>${"Patch notes, 1.4: the second boss telegraphs earlier, the arena's pillars break sooner, and saves sync across devices."}</p></div>` }),
    },
    {
      label: "Down a box, its parts marked: point at the rail for their names (by touch, drag its thumb; let go near a mark to go there)",
      markup: html`<div class="rail-box">${glassPane({ paneWidth: "fit", body: html`${["1.4", "1.3", "1.2", "1.1"].map(
        (version) => html`<h3 class="rail-example-part" data-rail-mark="${version}">Version ${version}</h3><p>${"Rebalanced the second boss, sped up loading, and fixed saves that wouldn't sync. ".repeat(3)}</p>`,
      )}` })}</div>`,
    },
    {
      label: "Sideways, its parts marked",
      markup: glassPane({ paneWidth: "fit", body: html`<div class="rail-side-box" data-fades-sideways data-side-rail><p>${["Monday", "Tuesday", "Wednesday", "Thursday"].map(
        (day) => html`<span data-rail-mark="${day}">${day}: 1,204 players, 3,906 hours. </span>`,
      )}</p></div>` }),
    },
  ],
});

/** Every stand-in game's cover, as a track's items. */
const STAND_IN_COVER_ITEMS: LayoutItem[] = Object.values(STAND_IN_COVERS).map((cover) => ({ kind: "block", markup: cover }));
/** A shelf of every stand-in game, for its arrows' states. */
const arrowsShelf = (id: string, title: string, scrolledTo?: "middle" | "end") =>
  glassPane({ paneWidth: "full", body: shelf({ id, trackId: `${id}-track`, title, items: STAND_IN_COVER_ITEMS, scrolledTo }) });

component({
  name: "Row arrows",
  slug: "row-arrows",
  group: "navigation",
  summary: "Scrolling a row of games with a mouse or trackpad: two raised slabs in a carved well. At a row's end that arrow lies flat; touch screens swipe instead.",
  styles: `
/* Arrows to scroll a row, for a mouse or trackpad, at the right of the row's heading: a carved well like a switch's, holding two raised
   slabs that slant where they meet. Pointing lifts one and sends its arrow on; a press sinks it, its light turning round. At a row's end
   that arrow lies flat in the well, faded. Touch screens swipe instead. */
.steps { --control-height: var(--control-height-small); position: relative; display: none; gap: 0; height: var(--control-height); padding: 3px; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
/* Each arrow is a Cut button sized for a well (actions.ts), icon only; at the row's end it can't be pressed. */
.steps > .cut-btn:first-of-type { margin-inline-end: var(--gap-control-row-boxes); }
@media (hover: hover) and (pointer: fine) { .steps { display: flex; } .steps[hidden] { display: none; } }
/* Without a mouse there are none, and a row holding them closes up before them (layout.ts, ROW_STYLES). */
.steps .ico { width: 10px; height: 13px; transition: transform 0.2s cubic-bezier(.2,.8,.2,1); }
.steps > .cut-btn:first-of-type:hover:not(:disabled) .ico { transform: translateX(-2px); }
.steps > .cut-btn:last-of-type:hover:not(:disabled) .ico { transform: translateX(2px); }
`,
  render: rowArrows,
  examples: [
    { label: "At the row's start: back lies flat (with a mouse; a touch screen swipes and shows none)", isWide: true, markup: arrowsShelf("example-arrows-start", "Popular") },
    { label: "Partway along: both can be pressed", isWide: true, markup: arrowsShelf("example-arrows-middle", "Trending", "middle") },
    { label: "At the row's end: on lies flat", isWide: true, markup: arrowsShelf("example-arrows-end", "New", "end") },
  ],
});

export interface ShelfOptions {
  /** Unique on the page: the shelf itself, for a page script (the home's Continue playing). */
  id: string;
  /** Its track's id, for its arrows and a page script that fills it. */
  trackId: string;
  title: string;
  /** Where its title goes, the whole list it's from (Browse, sorted the same way): the title is then a Link. Left out, it's words alone. */
  titleHref?: string;
  /** A small switch between ways to sort it (Recently played, Recently updated), after the title. */
  sortTabs?: SwitchTab[];
  /** Its covers. A page script may fill them in instead. */
  items: LayoutItem[];
  /** What it says while it has no covers (Continue playing before you've played anything), in place of its row and arrows. */
  emptyText?: string;
  /** Where its row starts scrolled to: the gallery's fixed states (Row arrows'). */
  scrolledTo?: "middle" | "end";
}

/**
 * A shelf: a row of games under its heading, with its sort and, for a mouse, its arrows at the heading's end, and its covers in a track
 * that scrolls sideways. Where the heading and the sort don't fit side by side (a phone), the sort and the arrows go under the heading and
 * fill that line, the sort's tabs sharing it.
 */
export function shelf(options: ShelfOptions): Raw {
  const titleId = `${options.id}-title`;
  const title = html`<h2 class="shelf-title" id="${titleId}">${options.titleHref ? textLink(options.title, options.titleHref) : options.title}</h2>`;
  const isEmpty = options.items.length === 0 && options.emptyText !== undefined;
  const controls: LayoutItem[] = [
    ...(options.sortTabs ? [{ kind: "control" as const, markup: tabSwitch({ label: "Sort", switchSize: "small", tabs: options.sortTabs }) }] : []),
    ...(isEmpty ? [] : [{ kind: "control" as const, markup: rowArrows({ rowName: options.title, trackId: options.trackId, scrolledTo: options.scrolledTo }) }]),
  ];
  return html`<section class="shelf" id="${options.id}" aria-labelledby="${titleId}">${stack({
    items: [
      controls.length
        ? {
            kind: "block",
            markup: row({
              widths: "lead-fills",
              // The sort and the arrows go together, so where they don't fit beside the heading they go under it as one, the sort filling.
              items: [{ kind: "words", markup: title }, { kind: "block", markup: options.sortTabs ? row({ widths: "lead-fills", items: controls }) : row({ widths: "fit", alignment: "end", items: controls }) }],
            }),
          }
        : { kind: "words", markup: title },
      isEmpty
        ? { kind: "words", markup: html`<p class="shelf-note">${options.emptyText}</p>` }
        : { kind: "block", markup: track({ id: options.trackId, itemSize: "cover", items: options.items }) },
    ],
  })}</section>`;
}

component({
  name: "Shelf",
  slug: "shelf",
  group: "navigation",
  summary: "A row of games under its heading: the home's Popular, Trending and Continue playing. Its sort and its arrows sit at the heading's end; its covers scroll sideways, a few showing with the next peeking in.",
  styles: `
/* A shelf: its heading, then its sort and its arrows together, in a row, then its track of covers. The heading keeps its whole width
   beside them, up to the shelf's own (a container), so they go under it before it wraps; only a heading longer than the shelf wraps,
   keeping the pane's margin at its end too. */
.shelf { container-type: inline-size; --shelf-words-inset: var(--pad-words); }
.shelf .shelf-title { width: max-content; max-width: calc(100cqi - 2 * var(--shelf-words-inset)); margin: 0; font: var(--type-section); color: var(--ink); text-wrap: balance; }
/* Under the heading, the sort and the arrows fill their line, never wider than it: the sort gives up room round its tabs' words to fit
   (Switch), so its cell may be narrower than its words at their roomiest (the heading's row has wrapped: is-wrapped, layout.ts). */
.shelf > .layout-stack > .stack-cell > .layout-row.is-wrapped > .row-cell.is-block { flex: 1 1 100%; min-width: 0; }
.shelf > .layout-stack > .stack-cell > .layout-row.is-wrapped > .row-cell.is-block > .layout-row { flex: 1 1 auto; }
.shelf > .layout-stack > .stack-cell > .layout-row.is-wrapped > .row-cell.is-block > .layout-row > .row-cell.fills { min-width: 0; }
/* With no games yet, a line in their place. */
.shelf .shelf-note { margin: 0; font: var(--type-words); color: var(--ink-2); }
`,
  render: shelf,
  examples: [
    { label: "Popular, its title a link to the whole list", isWide: true, markup: glassPane({ paneWidth: "full", body: shelf({ id: "example-shelf-popular", trackId: "example-shelf-popular-track", title: "Popular", titleHref: "#shelf", items: STAND_IN_COVER_ITEMS }) }) },
    {
      label: "Continue playing, with its sort",
      isWide: true,
      markup: glassPane({
        paneWidth: "full",
        body: shelf({
          id: "example-shelf-continue",
          trackId: "example-shelf-continue-track",
          title: "Continue playing",
          sortTabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }],
          items: STAND_IN_COVER_ITEMS.slice(0, 5),
        }),
      }),
    },
    {
      label: "A long title with its sort: on a phone the sort goes under it",
      isWide: true,
      markup: glassPane({
        paneWidth: "full",
        body: shelf({
          id: "example-shelf-long",
          trackId: "example-shelf-long-track",
          title: "Because you played Ashen Crown",
          titleHref: "#shelf",
          sortTabs: [{ label: "Most players", tabValue: "players", isCurrent: true }, { label: "Newest", tabValue: "newest", isCurrent: false }],
          items: STAND_IN_COVER_ITEMS.slice(2),
        }),
      }),
    },
    {
      label: "Empty: Continue playing before you've played anything",
      isWide: true,
      markup: glassPane({
        paneWidth: "full",
        body: shelf({ id: "example-shelf-empty", trackId: "example-shelf-empty-track", title: "Continue playing", items: [], emptyText: "Games you play show up here." }),
      }),
    },
  ],
});

/** A page's section: a link to it, with a count of what's new in it (unread reports) when there is one. */
export type SectionTab = Pick<SwitchTab, "label" | "isCurrent" | "badgeCount" | "state"> & { href: string };

export interface SectionTabsOptions {
  /** What the sections are, for a screen reader: "Game sections". */
  label: string;
  tabs: SectionTab[];
}

/** A page's own sections as tabs (a game dashboard's Overview, Versions, Players; a profile's Games and Friends): the header's tabs, under the page's title. */
export function sectionTabs(options: SectionTabsOptions): Raw {
  return html`<nav class="section-tabs" aria-label="${options.label}">${tabSwitch({ label: options.label, switchSize: "big", isFramed: true, tabs: options.tabs })}</nav>`;
}

const DASHBOARD_SECTIONS = ["Overview", "Versions", "Players", "Rooms", "Saves", "Reports", "Stats", "Settings"];
const PROFILE_SECTIONS = ["Games", "Friends", "Forum posts", "Saves", "Rooms"];

component({
  name: "Section tabs",
  slug: "section-tabs",
  group: "navigation",
  summary: "A page's own sections, under its title: a game dashboard's Overview, Versions and Players, a profile's Games and Friends. On a phone they scroll sideways, fading at the edge with more.",
  styles: `
/* Section tabs: the header's framed switch for a page's own sections. As wide as its tabs, and never wider than the page: past that
   they scroll sideways inside their frame, fading out over a side with more, and rest on whole tabs, starting where the one you're on shows whole. */
.section-tabs { display: flex; min-width: 0; max-width: 100%; }
.section-tabs > .switch-frame { flex: 0 1 auto; }
`,
  render: sectionTabs,
  examples: [
    { label: "A game's dashboard", isWide: true, markup: sectionTabs({ label: "Game sections", tabs: DASHBOARD_SECTIONS.map((label, tabIndex) => ({ label, href: "#section-tabs", isCurrent: tabIndex === 1 })) }) },
    {
      label: "With counts: reports waiting, players asking to join",
      isWide: true,
      markup: sectionTabs({ label: "Game sections", tabs: DASHBOARD_SECTIONS.map((label) => ({ label, href: "#section-tabs", isCurrent: label === "Players", badgeCount: label === "Players" ? 4 : label === "Reports" ? 12 : undefined })) }),
    },
    {
      label: "Pointed",
      isStill: true,
      markup: sectionTabs({ label: "Profile sections", tabs: PROFILE_SECTIONS.slice(0, 3).map((label, tabIndex) => ({ label, href: "#section-tabs", isCurrent: tabIndex === 0, state: tabIndex === 1 ? "is-pointed" : undefined })) }),
    },
    {
      label: "Keyboard focus",
      isStill: true,
      markup: sectionTabs({ label: "Profile sections", tabs: PROFILE_SECTIONS.slice(0, 3).map((label, tabIndex) => ({ label, href: "#section-tabs", isCurrent: tabIndex === 0, state: tabIndex === 1 ? "is-focused" : undefined })) }),
    },
    { label: "In a narrow pane: they scroll to the one you pick", markup: glassPane({ paneWidth: "fit", body: sectionTabs({ label: "Profile sections", tabs: PROFILE_SECTIONS.map((label, tabIndex) => ({ label, href: "#section-tabs", isCurrent: tabIndex === 2 })) }) }) },
  ],
});

export interface LoadMoreOptions {
  /** The next page's address: the same page with the next cursor. Left out, the list has ended, and its end words (endText) show instead. */
  href?: string;
  label: string;
  /** The id of the list it adds to; the next page has a list of the same id, and its own Load more for the page after, or its end words. */
  listId: string;
  /** What it says once the list has ended: "That's every version." */
  endText?: string;
  /** The last press didn't load, so it says so under the button: the gallery's fixed state (LOAD_MORE_SCRIPT says it as it happens). */
  isFailed?: boolean;
}

/** What Load more says under itself when the next page didn't come. */
const LOAD_FAILED_TEXT = "That didn't load. Check your connection, then try again.";

/**
 * Load more: a cut button under a long list that adds the next page to it in place. Without scripts it's a link to that page. Once the list
 * has ended, a line saying so takes its place.
 */
export function loadMore(options: LoadMoreOptions): Raw {
  if (!options.href) return html`<div class="load-more" data-load-more="${options.listId}"><p class="load-more-words">${options.endText ?? ""}</p></div>`;
  return html`<div class="load-more${options.isFailed ? " is-failed" : ""}" data-load-more="${options.listId}">${cutButton(options.label, { href: options.href, isFullWidth: true })}<p class="load-more-words" role="status"${options.isFailed ? "" : raw(" hidden")}>${options.isFailed ? LOAD_FAILED_TEXT : ""}</p></div>`;
}

/**
 * Load more: pressing it fetches its page, adds what's in that page's list of the same id to this one, and puts that page's own
 * Load more in its place (or its end words, or nothing, at the end). It's busy while it waits; if the page doesn't come, it says so under
 * the button and can be pressed again, and if the page has no list of that id, it goes there instead.
 */
export const LOAD_MORE_SCRIPT = `/* load more */(function () {
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("[data-load-more] > a.shell[href]");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var holder = link.parentElement, list = document.getElementById(holder.getAttribute("data-load-more")), words = holder.querySelector(".load-more-words");
    if (!list) return;
    event.preventDefault();
    if (link.getAttribute("aria-busy") === "true") return;
    link.setAttribute("aria-busy", "true");
    fetch(link.href, { headers: { accept: "text/html" }, credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.text();
    }).then(function (text) {
      var next = new DOMParser().parseFromString(text, "text/html"), more = next.getElementById(list.id);
      if (!more) { location.href = link.href; return; }
      Array.prototype.slice.call(more.children).forEach(function (child) { list.appendChild(document.importNode(child, true)); });
      var after = next.querySelector('[data-load-more="' + list.id + '"]');
      if (after) holder.replaceWith(document.importNode(after, true)); else holder.remove();
    }).catch(function () {
      link.removeAttribute("aria-busy"); holder.classList.add("is-failed");
      if (words) { words.textContent = ${JSON.stringify(LOAD_FAILED_TEXT)}; words.hidden = false; }
    });
  });
})();
`;

/** The example's first page of versions; the gallery serves the next two (design-page.ts, olderVersionsPage). */
const LOADED_ROWS = [14, 13, 12].map((versionNumber) => ({ title: `Version ${versionNumber}`, detail: versionNumber === 14 ? "Live · 2 days ago" : `Replaced · ${16 - versionNumber} weeks ago`, href: "#load-more" }));

component({
  name: "Load more",
  slug: "load-more",
  group: "navigation",
  summary: "Under a long list (versions, players, topics): the next page added in place, busy while it comes. Without scripts it's a link to that page.",
  styles: `
/* Load more: a full-width cut button under its list, a block below it, with what went wrong under it as a control's words; or, once the
   list has ended, a line of words saying so. */
.load-more { display: flex; flex-direction: column; gap: var(--gap-words-control); }
.load-more-words { margin: 0; font: var(--type-note); color: var(--muted); }
.load-more.is-failed .load-more-words { color: var(--marked); }
`,
  render: loadMore,
  examples: [
    { label: "Under a list: try it, to the last page", isWide: true, markup: glassPane({ paneWidth: "full", body: html`${listRows({ id: "example-load-more-list", rows: LOADED_ROWS })}${loadMore({ href: "/design/examples/older-versions?page=2", label: "Show older versions", listId: "example-load-more-list" })}` }) },
    { label: "Busy", markup: html`<div style="width:min(340px,100%)">${cutButton("Show older versions", { href: "#load-more", isFullWidth: true, isBusy: true })}</div>`, isStill: true },
    {
      label: "After a failed load: press it again",
      isWide: true,
      isStill: true,
      markup: glassPane({ paneWidth: "full", body: html`${listRows({ id: "example-load-failed-list", rows: LOADED_ROWS })}${loadMore({ href: "#load-more", label: "Show older versions", listId: "example-load-failed-list", isFailed: true })}` }),
    },
    {
      label: "At the end of the list",
      isWide: true,
      markup: glassPane({ paneWidth: "full", body: html`${listRows({ id: "example-load-end-list", rows: LOADED_ROWS })}${loadMore({ label: "Show older versions", listId: "example-load-end-list", endText: "That's every version." })}` }),
    },
  ],
});
