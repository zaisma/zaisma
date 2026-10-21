import { html, raw, type Raw } from "../markup.ts";
import { pageScript } from "../page-scripts.ts";
import { component } from "./component.ts";
import { CUT_LINE, EDGE, glassPane, icon, logo, railMarkup, type IconName } from "./foundations.ts";
import { cutButton, runButton, textLink } from "./actions.ts";
import { searchField, tabSwitch, type SearchFieldOptions, type SwitchTab } from "./inputs.ts";
import { STAND_IN_COVERS, dropdown, type DropdownItem } from "./panes.ts";
import { listRows, pictureFrame } from "./data.ts";

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
  /** Sign-in's header: only the logo, straight on the scene, with a halo that keeps it legible. */
  isLogoOnly?: boolean;
  /** Tabs of the page's own in place of Zaisma's (the admin pages'). */
  ownTabs?: SwitchTab[];
  /** Where Your games is, once its page exists: the tab shows for a signed-in account then. */
  yourGamesHref?: string;
  /** Fixed slim, as after scrolling: the gallery's state. */
  isCompact?: boolean;
  /** The account menu starts open: the gallery's state. */
  isMenuOpen?: boolean;
  /** Unique on the page, for the menu's id. Defaults to "top". */
  id?: string;
}

const tab = (label: string, href: string, isCurrent: boolean, isFoldable = false, isOpen = true): SwitchTab => ({ label, href, isCurrent, isFoldable, isFolded: isFoldable && !isOpen });

/** The header: a floating slab of glass, cut corners and a drawn rim. Orange only on what you act on. */
export function header(options: HeaderOptions): Raw {
  const id = options.id ?? "top";
  const account = options.account ?? null;
  const wordmark = logo("wordmark");
  if (options.isLogoOnly) return html`<header class="top is-logo-only" id="${id}">${wordmark}</header>`;
  const isOpen = options.isOnDeveloperPage;
  const menuId = `${id}-menu`;
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
  return html`<header class="top glass${options.isCompact ? " is-compact" : ""}" id="${id}" data-compacts data-glass data-glass-corners="20 14 20 14"${options.isCompact ? raw(" data-stays-compact") : ""}>${EDGE}
  ${wordmark}
  <nav class="nav" aria-label="Main">${tabSwitch({ label: "Where you are", switchSize: "big", isFramed: true, tabs: options.ownTabs ?? [tab("Home", "/", options.current === "home"), ...(account && options.yourGamesHref ? [tab("Your games", options.yourGamesHref, options.current === "your-games")] : []), tab("Developer", account ? "/dashboard" : "/developers", options.current === "developer", true, isOpen), tab("Forum", "/forum", options.current === "forum", true, isOpen)] })}</nav>
  ${options.search ? html`${searchField(options.search)}${cutButton(options.search.label, { type: "button", icon: "search", isLabelHidden: true, isSmall: true, isExpanded: false })}` : ""}
  <div class="end">${
    account
      ? accountButton({ username: account.username, pictureMarkup: account.pictureMarkup, menuId, isMenuOpen: options.isMenuOpen })
      : runButton("Sign in", { href: "/signin" })
  }</div>
</header>${account ? dropdown({ id: menuId, label: "Your account", head: { title: account.username, note: "Online" }, items: menuItems, isOpen: options.isMenuOpen }) : ""}`;
}

export interface AccountButtonOptions {
  username: string;
  /** Your picture: a Picture frame (data.ts), cut (isCut) so it fits the header's corner, and online. */
  pictureMarkup: Raw;
  /** The id of the account menu it opens. */
  menuId: string;
  isMenuOpen?: boolean;
  state?: "is-focused";
}

/**
 * You, signed in: your picture in its frame is the button itself, with no name or arrow beside it (a picture at a header's end reads as you,
 * and as something to press). It opens the account menu, a pane of the same glass, which names you.
 */
export function accountButton(options: AccountButtonOptions): Raw {
  return html`<button type="button" class="me${options.state ? ` ${options.state}` : ""}" aria-expanded="${options.isMenuOpen ? "true" : "false"}" aria-controls="${options.menuId}" aria-label="Your account, ${options.username}">${options.pictureMarkup}</button>`;
}

const HEADER_STYLES = `
/* The header: a floating slab of the sign-in's glass, cut corners and a drawn rim, over the page. Orange only on what you act on.
   It's adaptive glass: --glass-top sets its tint and thickness, and smoked glass (dark, or .smoke) gives it light words. */
.top {
  position: fixed; z-index: 10; top: var(--pad-pane); left: 50%; transform: translateX(-50%);
  width: min(1240px, calc(100% - 2 * var(--pad-pane))); height: 68px;
  display: flex; align-items: center; gap: 0; padding: 0 var(--pad-inner-pane);
  --glass-tint: var(--glass-top);
  clip-path: polygon(0 20px, 20px 0, calc(100% - 14px) 0, 100% 14px, 100% calc(100% - 20px), calc(100% - 20px) 100%, 14px 100%, 0 calc(100% - 14px));
  transition: var(--glass-transition), height 0.45s cubic-bezier(.2,.8,.2,1), top 0.45s cubic-bezier(.2,.8,.2,1), transform 0.45s cubic-bezier(.4,0,.2,1);
}
.top.is-compact { height: 58px; top: 8px; }
.top > :not(.edge) { position: relative; z-index: 3; }
.top .find, .top .find input, .top .run { transition: height 0.45s cubic-bezier(.2,.8,.2,1), width 0.45s cubic-bezier(.2,.8,.2,1), font-size 0.45s; }
/* Your picture is glass, so its changes start with the glass's. */
.top .frame { transition: var(--glass-transition), height 0.45s cubic-bezier(.2,.8,.2,1), width 0.45s cubic-bezier(.2,.8,.2,1); }
.top.is-compact .nav { --switch-height: 38px; }
.top.is-compact .find, .top.is-compact .run { height: 38px; }
.top.is-compact .run { font-size: 15px; }
.top.is-compact .me { --frame: 38px; }

/* The header's gap is a row of controls' (their boxes overlap by the slant); the logo is words beside them. */
.top > .logo { margin-right: var(--gap-block-block); }
/* Search beside Sign in is a row of two controls, so they slant toward each other; beside your account's picture it's words beside it. */
.top .find:has(~ .end > .run-wrap) { margin-inline-end: var(--gap-control-row-boxes); }
.top .find:has(~ .end > .me) { margin-inline-end: var(--gap-words-control); }
.top.is-compact .logo { --logo-height: 23px; }

/* Where you are: a framed Switch (inputs.ts), its tabs at their own widths; the header only places it and sets its height as it slims. */
.nav { display: flex; flex: none; min-width: 0; }
.nav > .switch-frame { flex: 1; }

/* Search sits after the tabs, pushed to the end. */
.top .find { margin-left: auto; }
.end { display: flex; align-items: center; flex: none; }
.top .find ~ .end { margin-left: 0; }
.top .nav + .end { margin-left: auto; }


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
  .top > .logo { margin-left: 6px; }
  .top > .logo, .top.is-compact > .logo { --logo-height: 22px; }
  .top .find { display: none; order: 5; flex-basis: 100%; max-width: none; margin: 0; }
  .top.searching .find { display: block; }
  .top.searching .nav { display: none; }
  .top > .find + .cut-btn { display: inline-flex; margin-left: auto; margin-right: var(--gap-words-control); }
  .top .nav + .end { margin-left: auto; }
  .top .nav { order: 4; flex-basis: 100%; --switch-height: 42px; }
  /* Signed out, the header's Sign in is the compact runner, so it shares the first row with Zaisma and search on the narrowest phones. */
  .top .end .run { height: 36px; padding: 0 16px 0 14px; font-size: 14px; gap: 6px; }
  /* The picture is as tall as the search button beside it, at rest or compact. */
  .top .me, .top.is-compact .me { --frame: 36px; }
  /* The search button and Sign in are a row of two controls, slanting toward each other; beside your picture, which never slants, it keeps a control's gap. */
  .top > .find + .cut-btn:has(~ .end > .run-wrap) { margin-right: var(--gap-control-row-boxes); }
  .top > .find + .cut-btn:has(~ .end > .me) { margin-right: var(--gap-control-stack); }
}

/* Sign-in's header: only the logo, straight on the scene. A soft halo keeps it legible over anything: light by day, dark at night. */
.top.is-logo-only { position: absolute; left: max(var(--pad-pane), calc((100% - 1240px) / 2)); transform: none; width: auto; height: 68px; padding: 0 var(--pad-inner-pane);
  background: none; -webkit-backdrop-filter: none; backdrop-filter: none; clip-path: none; }
.top.is-logo-only .logo { --logo-height: 30px; filter: var(--logo-halo); }
@media (max-width: 760px) {
  /* On a phone it sits level with the controls, and scrolls away with the page as the pane comes up. */
  .top.is-logo-only { top: calc(var(--pad-pane) + env(safe-area-inset-top, 0px)); left: max(var(--pad-pane), env(safe-area-inset-left, 0px)); height: 44px; padding: 0; }
  .top.is-logo-only .logo { margin-left: 0; }
  .top.is-logo-only .logo { --logo-height: 26px; }
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
  var headers = Array.prototype.slice.call(document.querySelectorAll("header.top:not(.is-logo-only)"));
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
  return html`<footer class="foot">
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


/** Arrows to scroll a row, for a mouse or trackpad: a cut well of two halves at the right of the row's heading. Touch screens swipe instead. */
export function rowArrows(options: { rowName: string; trackId: string }): Raw {
  const arrow = (way: "back" | "on") =>
    cutButton(`Scroll ${options.rowName} ${way}`, { type: "button", icon: way === "back" ? "arrow-back" : "arrow-on", isLabelHidden: true, isInWell: true, controls: options.trackId });
  return html`<div class="steps cut-carved" data-row-arrows data-cut-line="9">${CUT_LINE}${arrow("back")}${arrow("on")}</div>`;
}

/** A row's arrows scroll it by most of its width, lie flat at its ends, and hide when there's nothing to scroll; the row fades on a side with more (data-fades-sideways). */
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
  // Rows that scroll sideways: they start on the one you're on, and fade over a side with more past it.
  document.querySelectorAll("[data-fades-sideways]").forEach(function (row) {
    var here = row.querySelector('[aria-current="page"], [aria-pressed="true"]');
    if (here && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, here.offsetLeft - (row.clientWidth - here.offsetWidth) / 2);
    function ends() {
      var max = row.scrollWidth - row.clientWidth;
      row.classList.toggle("more-left", row.scrollLeft > 2); row.classList.toggle("more-right", row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
      row.classList.toggle("is-scrollable-sideways", max > 1);
    }
    row.addEventListener("scroll", function () { row.classList.toggle("more-left", row.scrollLeft > 2); row.classList.toggle("more-right", row.scrollLeft + row.clientWidth < row.scrollWidth - 2); }, { passive: true });
    window.zaismaWatch.size(row, ends); if (row.firstElementChild) window.zaismaWatch.size(row.firstElementChild, ends);
    ends();
  });
})();
`;

/**
 * A bar that slims once the page scrolls ([data-compacts]: the header, the gallery's bar): it turns compact past COMPACT_AT_PX and
 * roomy again only back at the very top, so it can't flip back and forth. Once a scroll has ended between the top and SETTLE_PX (and
 * your finger is off the screen), whichever way you were going, the page glides back to the top and the roomy bar. That glide waits for
 * a quiet moment after the last wheel, key or touch, and any of them stops it where it is, so scrolling again mid-glide never fights it. A bar over a
 * stand-in page (the gallery's header examples) follows that page's box, [data-scroll-box]; data-stays-compact keeps it compact.
 */
export const COMPACT_SCRIPT = `/* compact bars */(function () {
  var COMPACT_AT_PX = 24, SETTLE_PX = 56, still = window.matchMedia("(prefers-reduced-motion: reduce)"), hasScrollEnd = "onscrollend" in window;
  document.querySelectorAll("[data-compacts]").forEach(function (bar) {
    if (bar.hasAttribute("data-stays-compact")) { bar.classList.add("is-compact"); return; }
    // A bar follows the box that scrolls right beside it (a header example's stand-in page), or else the page: never a box deeper in, like a table.
    var box = bar.parentElement && bar.parentElement.querySelector(":scope > [data-scroll-box]"), scroller = box || window, target = box || document.documentElement;
    // The page doesn't shift itself to keep your place as the bar slims (scroll anchoring): that shift is what fought the glide.
    target.style.overflowAnchor = "none";
    function at() { return box ? box.scrollTop : window.scrollY; }
    // Nothing glides while a finger is down, or until a moment after the last wheel, key or touch; any of them stops a glide that is running.
    var QUIET_MS = 160, isTouching = false, isGliding = false, lastInputMs = 0, timer = 0;
    function noteInput() {
      lastInputMs = performance.now();
      if (isGliding) { isGliding = false; scroller.scrollTo({ top: at(), behavior: "auto" }); }
    }
    function sync() { var y = at(); if (y > COMPACT_AT_PX) bar.classList.add("is-compact"); else if (y <= 0) bar.classList.remove("is-compact"); }
    function settle() {
      clearTimeout(timer);
      if (isTouching) return;
      var quietFor = performance.now() - lastInputMs;
      if (quietFor < QUIET_MS) { timer = setTimeout(settle, QUIET_MS - quietFor); return; }
      var y = at();
      if (y > 0 && y < SETTLE_PX) { isGliding = !still.matches; scroller.scrollTo({ top: 0, behavior: still.matches ? "auto" : "smooth" }); } else isGliding = false;
    }
    scroller.addEventListener("scroll", function () {
      sync();
      if (!hasScrollEnd) { clearTimeout(timer); timer = setTimeout(settle, 180); }
    }, { passive: true });
    if (hasScrollEnd) scroller.addEventListener("scrollend", function () { if (at() <= 0) isGliding = false; settle(); });
    ["wheel", "keydown", "pointerdown"].forEach(function (kind) { (box || window).addEventListener(kind, noteInput, { passive: true }); });
    window.addEventListener("touchstart", function () { isTouching = true; noteInput(); }, { passive: true });
    window.addEventListener("touchend", function () { isTouching = false; if (!hasScrollEnd) { clearTimeout(timer); timer = setTimeout(settle, 180); } }, { passive: true });
    window.addEventListener("touchcancel", function () { isTouching = false; }, { passive: true });
    sync();
  });
})();
`;

export const ROW_SCRIPT = `/* rows */(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("[data-row-arrows]").forEach(function (steps) {
    var arrows = steps.querySelectorAll(".cut-btn"), back = arrows[0], on = arrows[1], track = document.getElementById(back.getAttribute("aria-controls"));
    if (!track) return;
    function ends() {
      var more = track.scrollWidth - track.clientWidth, left = track.scrollLeft > 2, right = track.scrollLeft < more - 2;
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
const STAND_IN_ACCOUNT = { username: "emma_r", pictureMarkup: pictureFrame("emma_r", "md", { presence: "online", isCut: true }) };
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
    { label: "Signed out, on Home", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-out", current: "home", search: GAMES_SEARCH, account: null, isOnDeveloperPage: false })) },
    { label: "Signed in, menu open", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-in", current: "home", search: GAMES_SEARCH, account: STAND_IN_ACCOUNT, isOnDeveloperPage: false, isMenuOpen: true, yourGamesHref: "#header" }), true) },
    { label: "On the dashboard", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-dev", current: "developer", account: STAND_IN_ACCOUNT, isOnDeveloperPage: true, yourGamesHref: "#header" })) },
    { label: "Compact, after scrolling", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-compact", current: "home", search: GAMES_SEARCH, account: STAND_IN_ACCOUNT, isOnDeveloperPage: false, isCompact: true, yourGamesHref: "#header" })) },
    { label: "Logo only, on sign-in", isWide: true, isStill: true, markup: html`<div class="header-frame logo-frame"><div class="backdrop is-framed" aria-hidden="true"></div>${header({ id: "example-top-logo", current: null, isOnDeveloperPage: false, isLogoOnly: true })}</div>` },
  ],
});

component({
  name: "Account button",
  slug: "account-button",
  group: "navigation",
  summary: "You, at the header's end once you're signed in: your picture alone is the button, online, as tall as the controls beside it. It opens the account menu, which names you.",
  styles: `
/* Your picture in its frame, as tall as the controls beside it and cut by the edge rule like them (Picture frame's isCut), so it fits the
   header's corner. Pointing brightens it, pressing sinks it a little, and with the menu open or by keyboard its rim turns orange. Online,
   its green line runs inside the frame's foot, so nothing sits outside the button to crowd the header's edge or what's below it. */
.me { --frame: 44px; position: relative; display: flex; padding: 0; border: 0; background: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.me .frame { --frame: inherit; transition: var(--glass-transition), width 0.45s cubic-bezier(.2,.8,.2,1), height 0.45s cubic-bezier(.2,.8,.2,1), scale 0.15s; }
.me .frame-picture { transition: filter 0.2s; }
.me:hover .frame-picture, .me[aria-expanded="true"] .frame-picture { filter: brightness(1.1); }
.me:active .frame { scale: 0.95; }
.me:focus-visible { outline: none; }
.me:focus-visible .frame > .edge, .me.is-focused .frame > .edge, .me[aria-expanded="true"] .frame > .edge { opacity: 1; }
.me:focus-visible .frame > .edge .hair, .me.is-focused .frame > .edge .hair, .me[aria-expanded="true"] .frame > .edge .hair { stroke: var(--focus); stroke-width: 2; }
`,
  render: accountButton,
  examples: [
    { label: "Rest", markup: accountButton({ ...STAND_IN_ACCOUNT, menuId: "example-me-menu" }) },
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
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-block-block); margin-top: var(--gap-block-block); padding-top: var(--gap-block-block); border-top: var(--divider); color: var(--muted); font: var(--type-note); }
/* Quiet links in a row read as one sentence at a word's gap, so each sits three apart: a list of places, not a line of words. */
.foot nav { display: flex; flex-wrap: wrap; gap: var(--gap-words-words) calc(3 * var(--gap-words-words)); }
.foot p { margin: 0 0 0 auto; }
@media (max-width: 760px) { .foot p { margin: 0; } }
`,
  render: footer,
  examples: [{ label: "On glass", isWide: true, markup: glassPane({ paneSize: "full", body: footer() }) }],
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
      markup: html`<div class="rail-box">${glassPane({ paneSize: "small", body: html`<p>${"Wander a forest that grows around you. No combat and no timers: climbing, finding and listening. ".repeat(14)}</p>` })}</div>`,
    },
    {
      label: "Sideways, under a box (a table, a chart)",
      markup: glassPane({ paneSize: "small", body: html`<div class="rail-side-box" data-fades-sideways data-side-rail><p>${"Patch notes, 1.4: the second boss telegraphs earlier, the arena's pillars break sooner, and saves sync across devices."}</p></div>` }),
    },
    {
      label: "Down a box, its parts marked: point at the rail for their names (by touch, drag its thumb; let go near a mark to go there)",
      markup: html`<div class="rail-box">${glassPane({ paneSize: "small", body: html`${["1.4", "1.3", "1.2", "1.1"].map(
        (version) => html`<h3 class="rail-example-part" data-rail-mark="${version}">Version ${version}</h3><p>${"Rebalanced the second boss, sped up loading, and fixed saves that wouldn't sync. ".repeat(3)}</p>`,
      )}` })}</div>`,
    },
    {
      label: "Sideways, its parts marked",
      markup: glassPane({ paneSize: "small", body: html`<div class="rail-side-box" data-fades-sideways data-side-rail><p>${["Monday", "Tuesday", "Wednesday", "Thursday"].map(
        (day) => html`<span data-rail-mark="${day}">${day}: 1,204 players, 3,906 hours. </span>`,
      )}</p></div>` }),
    },
  ],
});

component({
  name: "Row arrows",
  slug: "row-arrows",
  group: "navigation",
  summary: "Scrolling a row of games with a mouse or trackpad: two raised slabs in a carved well. At a row's end that arrow lies flat; touch screens swipe instead.",
  styles: `
/* Arrows to scroll a row, for a mouse or trackpad, at the right of the row's heading: a carved well like a switch's, holding two raised
   slabs that slant where they meet. Pointing lifts one and sends its arrow on; a press sinks it, its light turning round. At a row's end
   that arrow lies flat in the well, faded. Touch screens swipe instead. */
.steps { position: relative; margin-left: auto; display: none; gap: 0; height: 36px; padding: 3px; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
/* Each arrow is a Cut button sized for a well (actions.ts), icon only; at the row's end it can't be pressed. */
.steps > .cut-btn:first-of-type { margin-inline-end: var(--gap-control-row-boxes); }
@media (hover: hover) and (pointer: fine) { .steps { display: flex; } .steps[hidden] { display: none; } }
.steps .ico { width: 10px; height: 13px; transition: transform 0.2s cubic-bezier(.2,.8,.2,1); }
.steps > .cut-btn:first-of-type:hover:not(:disabled) .ico { transform: translateX(-2px); }
.steps > .cut-btn:last-of-type:hover:not(:disabled) .ico { transform: translateX(2px); }
/* A row scrolls sideways, a little in from its glass's rim, so covers never touch the frame. Where more covers carry on, that edge fades out
   softly: the shared sideways fade (data-fades-sideways), further in for covers. */
.track { --fade-sideways-px: 56px; display: flex; gap: var(--gap-block-block); scroll-snap-type: x proximity; scroll-padding-inline: 8px; padding: 10px 8px 6px; margin: -10px -8px -6px; }
.track > .cover { flex: 0 0 236px; scroll-snap-align: start; }
.row-head { display: flex; align-items: center; gap: var(--gap-words-control); margin-bottom: var(--gap-words-control); min-height: 36px; }
.row-head h2 { margin: 0; font: var(--type-section); white-space: nowrap; color: var(--ink); }
@media (max-width: 760px) { .track { --fade-sideways-px: 32px; } .track > .cover { flex-basis: 64vw; } }
`,
  render: rowArrows,
  examples: [
    {
      label: "A row, at its start",
      isWide: true,
      markup: glassPane({ paneSize: "full", body: html`<section class="row"><div class="row-head"><h2>Popular</h2>${rowArrows({ rowName: "Popular", trackId: "example-track" })}</div><div class="track" id="example-track" data-fades-sideways>${Object.values(STAND_IN_COVERS)}</div></section>` }),
    },
  ],
});


export interface SectionTabsOptions {
  /** What the sections are, for a screen reader: "Game sections". */
  label: string;
  tabs: { label: string; href: string; isCurrent: boolean }[];
}

/** A page's own sections as tabs (a game dashboard's Overview, Versions, Players; a profile's Games and Friends): the header's tabs, under the page's title. */
export function sectionTabs(options: SectionTabsOptions): Raw {
  return html`<nav class="section-tabs" aria-label="${options.label}">${tabSwitch({ label: options.label, switchSize: "big", isFramed: true, tabs: options.tabs })}</nav>`;
}

component({
  name: "Section tabs",
  slug: "section-tabs",
  group: "navigation",
  summary: "A page's own sections, under its title: a game dashboard's Overview, Versions and Players, a profile's Games and Friends. On a phone they scroll sideways, fading at the edge with more.",
  styles: `
/* Section tabs: the header's framed switch for a page's own sections. As wide as its tabs, and never wider than the page: past that
   they scroll sideways inside their frame, fading out over a side with more, starting on the one you're on. */
.section-tabs { display: flex; min-width: 0; max-width: 100%; }
.section-tabs > .switch-frame { flex: 0 1 auto; }
`,
  render: sectionTabs,
  examples: [
    { label: "A game's dashboard", isWide: true, markup: sectionTabs({ label: "Game sections", tabs: ["Overview", "Versions", "Players", "Rooms", "Saves", "Stats", "Settings"].map((label, tabIndex) => ({ label, href: "#section-tabs", isCurrent: tabIndex === 1 })) }) },
    { label: "In a narrow pane: they scroll to the one you pick", markup: glassPane({ paneSize: "small", body: sectionTabs({ label: "Profile sections", tabs: ["Games", "Friends", "Forum posts", "Saves", "Rooms"].map((label, tabIndex) => ({ label, href: "#section-tabs", isCurrent: tabIndex === 2 })) }) }) },
  ],
});

export interface LoadMoreOptions {
  /** The next page's address: the same page with the next cursor. */
  href: string;
  label: string;
  /** The id of the list it adds to; the next page has a list of the same id, and its own Load more for the page after. */
  listId: string;
}

/** Load more: a cut button under a long list that adds the next page to it in place. Without scripts it's a link to that page. */
export function loadMore(options: LoadMoreOptions): Raw {
  return html`<div class="load-more" data-load-more="${options.listId}">${cutButton(options.label, { href: options.href, isFullWidth: true })}</div>`;
}

/**
 * Load more: pressing it fetches its page, adds what's in that page's list of the same id to this one, and puts that page's own
 * Load more in its place (or none, at the end). It's busy while it waits; if the page doesn't come, it goes there instead.
 */
export const LOAD_MORE_SCRIPT = `/* load more */(function () {
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("[data-load-more] > a.shell[href]");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var holder = link.parentElement, list = document.getElementById(holder.getAttribute("data-load-more"));
    if (!list) return;
    event.preventDefault();
    if (link.getAttribute("aria-busy") === "true") return;
    link.setAttribute("aria-busy", "true");
    fetch(link.href, { headers: { accept: "text/html" }, credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.text();
    }).then(function (text) {
      var next = new DOMParser().parseFromString(text, "text/html"), more = next.getElementById(list.id);
      if (!more) throw new Error("no list");
      Array.prototype.slice.call(more.children).forEach(function (child) { list.appendChild(document.importNode(child, true)); });
      var after = next.querySelector('[data-load-more="' + list.id + '"]');
      if (after) holder.replaceWith(document.importNode(after, true)); else holder.remove();
    }).catch(function () { location.href = link.href; });
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
/* Load more: a full-width cut button under its list, a block below it. */
.load-more { display: flex; }
`,
  render: loadMore,
  examples: [
    { label: "Under a list: try it, to the last page", isWide: true, markup: glassPane({ paneSize: "medium", body: html`${listRows({ id: "example-load-more-list", rows: LOADED_ROWS })}${loadMore({ href: "/design/examples/older-versions?page=2", label: "Show older versions", listId: "example-load-more-list" })}` }) },
    { label: "Busy", markup: html`<div style="width:min(340px,100%)">${cutButton("Show older versions", { href: "#load-more", isFullWidth: true, isBusy: true })}</div>`, isStill: true },
  ],
});
