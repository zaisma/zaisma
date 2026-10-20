import { html, raw, type Raw } from "../html.ts";
import { pageScript } from "../page-scripts.ts";
import { component } from "./component.ts";
import { CUT_LINE, EDGE, MARK, WORDMARK, icon, railMarkup, type IconName } from "./foundations.ts";
import { runButton } from "./actions.ts";
import { searchField, type SearchFieldOptions } from "./inputs.ts";
import { STAND_IN_COVERS, accountMenu, type MenuItem } from "./panes.ts";
import { pictureFrame } from "./data.ts";

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
  /** Where Your games is, once its page exists: the tab shows for a signed-in account then. */
  yourGamesHref?: string;
  /** Fixed slim, as after scrolling: the gallery's state. */
  isCompact?: boolean;
  /** The account menu starts open: the gallery's state. */
  isMenuOpen?: boolean;
  /** Unique on the page, for the menu's id. Defaults to "top". */
  id?: string;
}

const tab = (label: string, href: string, isCurrent: boolean, isDeveloperTab = false, isOpen = true) =>
  html`<a href="${href}"${isDeveloperTab ? raw(isOpen ? ' class="dev"' : ' class="dev off" tabindex="-1" aria-hidden="true"') : ""}${isCurrent ? raw(' aria-current="page"') : ""}>${label}</a>`;

/** The header: a floating slab of glass, cut corners and a drawn rim. Orange only on what you act on. */
export function header(options: HeaderOptions): Raw {
  const id = options.id ?? "top";
  const account = options.account ?? null;
  const logo = html`<a class="logo" href="/" aria-label="Zaisma home">${WORDMARK}</a>`;
  if (options.isLogoOnly) return html`<header class="top is-logo-only" id="${id}">${logo}</header>`;
  const isOpen = options.isOnDeveloperPage;
  const menuId = `${id}-menu`;
  const menuItems: MenuItem[] = account
    ? [
        { kind: "link", label: "Your profile", icon: "person", href: `/@${account.username}` },
        { kind: "link", label: "Friends", icon: "friends", href: "/friends" },
        { kind: "link", label: "Developer", icon: "code", href: "/dashboard" },
        { kind: "link", label: "Settings", icon: "gear", href: "/account" },
        { kind: "rule" },
        { kind: "form", label: "Sign out", icon: "sign-out", action: "/signout" },
      ]
    : [];
  return html`<header class="top glass${options.isCompact ? " is-compact" : ""}" id="${id}" data-glass data-glass-corners="16 6 16 6"${options.isCompact ? raw(" data-stays-compact") : ""}>${EDGE}
  ${logo}
  <nav class="nav" aria-label="Main" data-cut-line="10">${CUT_LINE}<span class="ghost" aria-hidden="true"></span><span class="slab" aria-hidden="true"></span>${tab("Home", "/", options.current === "home")}${account && options.yourGamesHref ? tab("Your games", options.yourGamesHref, options.current === "your-games") : ""}${tab("Developer", account ? "/dashboard" : "/developers", options.current === "developer", true, isOpen)}${tab("Forum", "/forum", options.current === "forum", true, isOpen)}</nav>
  ${options.search ? html`${searchField(options.search)}<button type="button" class="find-open" aria-label="${options.search.label}" aria-expanded="false">${icon("search")}</button>` : ""}
  <div class="end">${
    account
      ? html`<button type="button" class="me" aria-expanded="${options.isMenuOpen ? "true" : "false"}" aria-controls="${menuId}" aria-label="Your account, ${account.username}">${account.pictureMarkup}<span class="name">${account.username}</span><svg class="chev" viewBox="0 0 20 12" width="12" height="8" aria-hidden="true"><path d="M2 2l8 8 8-8" fill="none" stroke="currentColor" stroke-width="2.4"/></svg></button>`
      : runButton("Sign in", { href: "/signin" })
  }</div>
</header>${account ? accountMenu({ id: menuId, label: "Your account", who: { name: account.username, note: "Online" }, items: menuItems, isOpen: options.isMenuOpen }) : ""}`;
}

const HEADER_STYLES = `
/* The header: a floating slab of the sign-in's glass, cut corners and a drawn rim, over the page. Orange only on what you act on.
   It's adaptive glass: --glass-top sets its tint and thickness, and smoked glass (dark, or .smoke) gives it light words. */
.top {
  position: fixed; z-index: 10; top: 12px; left: 50%; transform: translateX(-50%);
  width: min(1240px, calc(100% - 24px)); height: 68px;
  display: flex; align-items: center; gap: 22px; padding: 0 14px 0 26px;
  --glass-tint: var(--glass-top);
  clip-path: polygon(0 16px, 16px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 16px), calc(100% - 16px) 100%, 6px 100%, 0 calc(100% - 6px));
  transition: height 0.45s cubic-bezier(.2,.8,.2,1), top 0.45s cubic-bezier(.2,.8,.2,1), transform 0.45s cubic-bezier(.4,0,.2,1), background-color 0.5s ease;
}
.top.is-compact { height: 58px; top: 8px; }
.top > :not(.edge) { position: relative; z-index: 3; }
.top .nav, .top .find, .top .find input, .top .run, .top .me, .top .frame { transition: height 0.45s cubic-bezier(.2,.8,.2,1), width 0.45s cubic-bezier(.2,.8,.2,1), font-size 0.45s; }
.top.is-compact .nav, .top.is-compact .find, .top.is-compact .run, .top.is-compact .me { height: 38px; }
.top.is-compact .run { font-size: 15px; }
.top.is-compact .me .frame { --frame: 32px; --frame-cut: 8px; }

.logo { display: flex; align-items: center; flex: none; padding: 6px 2px; color: var(--ink); }
.logo svg { height: 26px; width: auto; display: block; transition: height 0.45s cubic-bezier(.2,.8,.2,1), color 0.3s; }
.top.is-compact .logo svg { height: 23px; }
.logo:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

/* Where you are: the sign-in's switch, laid flat. A white slab with an orange underline sits under the page you're on; a faint one follows the pointer. */
.nav { position: relative; display: flex; height: 44px; padding: 4px; flex: none;
  background: var(--well); box-shadow: var(--well-shade);
  clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%); }
.nav .slab, .nav .ghost { position: absolute; top: 4px; bottom: 4px; left: 0; width: 0; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); pointer-events: none;
  transition: transform 0.55s var(--spring), width 0.55s var(--spring), opacity 0.3s; }
.nav .slab { background: var(--slab); box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run); }
.nav .ghost { background: var(--ghost); opacity: 0; }
.nav.pointing .ghost { opacity: 1; }
.nav a { position: relative; display: flex; align-items: center; padding: 0 18px; font: 500 15px var(--display); color: var(--ink-2); text-decoration: none; white-space: nowrap; }
.nav a[aria-current="page"] { color: var(--ink); font-weight: 600; }
.nav a:focus-visible { outline: 2px solid var(--ink); outline-offset: -4px; }
/* Before the script has measured, the tab you're on carries its own slab. */
.nav:not(.is-ready) a[aria-current="page"] { background: var(--slab); box-shadow: inset 0 -3px 0 var(--run); clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); }
/* The Developer and Forum tabs open out of the end of the tabs on a developer page and fold back into it when you leave, while the slab slides. */
.nav a.dev { max-width: 160px; overflow: hidden; transition: max-width 0.45s cubic-bezier(.2,.8,.2,1), padding 0.45s cubic-bezier(.2,.8,.2,1), opacity 0.3s 0.08s; }
.nav a.dev.off { max-width: 0; padding-left: 0; padding-right: 0; opacity: 0; pointer-events: none; transition: max-width 0.4s cubic-bezier(.4,0,.2,1), padding 0.4s cubic-bezier(.4,0,.2,1), opacity 0.16s; }

/* Search sits after the tabs, pushed to the end. */
.top .find { margin-left: auto; }
.end { display: flex; align-items: center; gap: 10px; flex: none; }
.top .find ~ .end, .top .find-open ~ .end { margin-left: 0; }
.top .nav + .end { margin-left: auto; }

/* Signed in: your picture in a cut frame, with your name; it opens a pane of the same glass. */
.me { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 12px 0 4px; border: 0; background: none; cursor: pointer; font: 500 15px var(--display); color: var(--ink); }
.me:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
/* You're online: a small diamond on your picture's corner. */
.me .frame { overflow: visible; clip-path: none; background: none; }
.me .frame::before { content: ""; position: absolute; inset: 0; background: var(--face-ring); clip-path: polygon(var(--frame-cut) 0, 100% 0, 100% calc(100% - var(--frame-cut)), calc(100% - var(--frame-cut)) 100%, 0 100%, 0 var(--frame-cut)); }
.me .frame::after { content: ""; position: absolute; right: -2px; bottom: -2px; width: 11px; height: 11px; background: #3BB273; border: 2px solid var(--presence-ring); transform: rotate(45deg); }
.me .chev { transition: transform 0.4s cubic-bezier(.2,.8,.2,1); }
.me[aria-expanded="true"] .chev { transform: rotate(180deg); }

/* Phones: one slab in two rows: the logo, a search button and you on top; where you are below. */
.find-open { display: none; }
@media (max-width: 760px) {
  /* The header floats on phones too: a slab of glass inset from every edge (below the notch), never touching the screen's sides. */
  .top { top: calc(10px + env(safe-area-inset-top, 0px)); width: calc(100% - 20px); height: auto; flex-wrap: wrap; gap: 10px 8px; padding: 10px 12px 12px; }
  /* Compact keeps the same inset around the tabs as at rest; only the rows themselves get shorter. */
  .top.is-compact { top: calc(6px + env(safe-area-inset-top, 0px)); height: auto; padding-top: 6px; padding-bottom: 12px; row-gap: 6px; }
  .logo { margin-left: 6px; }
  .logo svg, .top.is-compact .logo svg { height: 22px; }
  .top .find { display: none; order: 5; flex-basis: 100%; max-width: none; margin: 0; }
  .top.searching .find { display: block; }
  .top.searching .nav { display: none; }
  .find-open { display: grid; place-items: center; width: 44px; height: 44px; margin-left: auto; border: 0; background: none; color: var(--ink); cursor: pointer; }
  .find-open .ico { width: 20px; height: 20px; }
  .find-open:focus-visible { outline: 2px solid var(--ink); outline-offset: -4px; }
  .top .nav + .end { margin-left: auto; }
  .top .nav { order: 4; flex-basis: 100%; height: 42px; }
  .top.is-compact .find-open { height: 38px; }
  .nav a { flex: 1; justify-content: center; padding: 0 8px; }
  .me .name { display: none; }
}

/* Sign-in's header: only the logo, straight on the scene. A soft halo keeps it legible over anything: light by day, dark at night. */
.top.is-logo-only { position: absolute; left: max(12px, calc((100% - 1240px) / 2)); transform: none; width: auto; height: 68px; padding: 0 26px;
  background: none; -webkit-backdrop-filter: none; backdrop-filter: none; clip-path: none; }
.top.is-logo-only .logo svg { height: 30px; filter: var(--logo-halo); }
@media (max-width: 760px) {
  /* On a phone it sits level with the controls, and scrolls away with the page as the pane comes up. */
  .top.is-logo-only { top: calc(10px + env(safe-area-inset-top, 0px)); left: max(16px, env(safe-area-inset-left, 0px)); height: 44px; padding: 0; }
  .top.is-logo-only .logo { margin-left: 0; }
  .top.is-logo-only .logo svg { height: 26px; }
}
@media (prefers-reduced-motion: reduce) {
  .top, .nav .slab, .nav .ghost, .nav a.dev, .logo svg { transition: none; }
}
`;

/**
 * The header's own behaviour: it slims once the page scrolls (the gallery's frames scroll a box of their own,
 * [data-scroll-box]), the slab sits under the current page and a faint one follows the pointer, "/" jumps to search,
 * and on a phone the search button swaps the tabs for the field. The menu is MENU_SCRIPT's.
 */
export const HEADER_SCRIPT = pageScript(
  "header",
  `(function () {
  var phone = function () { return window.innerWidth <= 760; };
  var headers = Array.prototype.slice.call(document.querySelectorAll("header.top:not(.is-logo-only)"));
  headers.forEach(function (top) {
    var frame = top.parentElement && top.parentElement.querySelector("[data-scroll-box]"), scroller = frame || window;
    /* Once the page scrolls, the slab gets slimmer and everything in it shrinks to fit. */
    function scrolled() { if (top.hasAttribute("data-stays-compact")) return; top.classList.toggle("is-compact", (frame ? frame.scrollTop : window.scrollY) > 24); }
    scroller.addEventListener("scroll", scrolled, { passive: true }); scrolled();

    /* Where you are: the white slab sits under the current page; a faint one follows the pointer across the others. */
    var nav = top.querySelector(".nav"), slab = nav.querySelector(".slab"), ghost = nav.querySelector(".ghost"), links = nav.querySelectorAll("a"), devTabs = nav.querySelectorAll(".dev");
    // A page that isn't one of these (like sign-in) has no current link, so no slab.
    function put(el, link) { if (!link) { el.style.width = "0px"; return; } el.style.width = link.offsetWidth + "px"; el.style.transform = "translateX(" + link.offsetLeft + "px)"; }
    function current() { return nav.querySelector('[aria-current="page"]'); }
    function settle() { var on = current(); slab.style.transition = "none"; put(slab, on); put(ghost, on); slab.offsetWidth; slab.style.transition = ""; nav.classList.add("is-ready"); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
    settle();
    if (window.ResizeObserver) new ResizeObserver(settle).observe(nav); else window.addEventListener("resize", settle);
    links.forEach(function (link) {
      link.addEventListener("pointerenter", function () { if (link !== current()) { put(ghost, link); nav.classList.add("pointing"); } else nav.classList.remove("pointing"); });
      // The slab goes to the tab you chose at once, while its page loads.
      link.addEventListener("click", function () {
        if (current()) current().removeAttribute("aria-current"); link.setAttribute("aria-current", "page");
        nav.classList.remove("pointing"); developerTab(link.classList.contains("dev"));
      });
    });
    nav.addEventListener("pointerleave", function () { nav.classList.remove("pointing"); });
    // Opens or folds the Developer and Forum tabs, and sends the slab straight to where the current tab will be once it has (measured first, without the motion).
    function developerTab(on) {
      if (!devTabs.length) return;
      var was = !devTabs[0].classList.contains("off"), link = current();
      function fold(isOff) { devTabs.forEach(function (each) { each.classList.toggle("off", isOff); }); }
      devTabs.forEach(function (each) { each.style.transition = "none"; }); fold(!on);
      var left = link ? link.offsetLeft : 0, width = link ? link.offsetWidth : 0;
      fold(!was); devTabs[0].offsetWidth; devTabs.forEach(function (each) { each.style.transition = ""; });
      fold(!on); devTabs.forEach(function (each) { each.tabIndex = on ? 0 : -1; each.setAttribute("aria-hidden", String(!on)); });
      slab.style.width = width + "px"; slab.style.transform = "translateX(" + left + "px)";
      ghost.style.width = width + "px"; ghost.style.transform = "translateX(" + left + "px)";
    }

    /* Search: on a phone the search button swaps the row below for the field. */
    var search = top.querySelector('.find input[type="search"]'), findOpen = top.querySelector(".find-open");
    top.openSearch = function () { if (!search) return; top.classList.add("searching"); if (findOpen) findOpen.setAttribute("aria-expanded", "true"); search.focus(); };
    top.closeSearch = function () { top.classList.remove("searching"); if (findOpen) findOpen.setAttribute("aria-expanded", "false"); };
    if (findOpen) findOpen.addEventListener("click", function () { if (top.classList.contains("searching")) top.closeSearch(); else top.openSearch(); });
    if (search) search.addEventListener("blur", function () { if (phone() && !search.value) setTimeout(top.closeSearch, 120); });
  });
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
export function footer(): Raw {
  return html`<footer class="foot">
  <a class="mark" href="/" aria-label="Zaisma home">${MARK}</a>
  <nav aria-label="More from Zaisma"><a href="/dashboard">For game developers</a><a href="/forum">Forum</a><a href="https://github.com/zaisma/zaisma">Source code</a><a href="/legal/content-rules">Content rules</a><a href="/legal/privacy">Privacy</a><a href="/legal/security">Security</a><a href="/legal/dmca">Copyright (DMCA)</a><a href="/legal/defamation">Defamation</a></nav>
  <p>Zaisma is open source, under the MIT license.</p>
</footer>`;
}

/** Zaisma's own scrollbar, for a mouse or trackpad: "page" for the page, "box" for a box that scrolls (put it just after that box). */
export function rail(scrollKind: "box" | "page"): Raw {
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
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  // Any box that scrolls up and down gets its rail by itself, so a new component never has to remember one. A box that
  // hides its scrollbar on purpose (scrollbar-width: none) keeps it hidden. A text box or list box gets one too, laid over its own edge.
  document.querySelectorAll("body *").forEach(function (box) {
    var isControl = box.tagName === "TEXTAREA" || (box.tagName === "SELECT" && (box.multiple || box.size > 1));
    if ((/^(SELECT|INPUT)$/.test(box.tagName) && !isControl) || (box.nextElementSibling && box.nextElementSibling.hasAttribute("data-rail"))) return;
    var style = getComputedStyle(box);
    if (!/^(auto|scroll)$/.test(style.overflowY) || style.scrollbarWidth === "none" || box.classList.contains("rail-thumb")) return;
    var parent = box.parentElement; if (!parent || parent === document.body) return;
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    box.insertAdjacentHTML("afterend", '<div class="rail"' + (isControl ? " data-rail-follows" : "") + ' data-rail="box" aria-hidden="true"><div class="rail-line"></div><div class="rail-thumb"></div></div>');
  });
  document.querySelectorAll("[data-rail]").forEach(function (bar) {
    var isPage = bar.getAttribute("data-rail") === "page", scroller = isPage ? null : bar.previousElementSibling;
    if (!isPage && !scroller) return;
    var line = bar.querySelector(".rail-line"), thumb = bar.querySelector(".rail-thumb");
    if (isPage) document.documentElement.classList.add("own-scroll"); else scroller.classList.add("own-scroll");
    bar.classList.add("is-on");
    // The page's marks: one per marked part, sitting where the thumb's middle will be once that part is at the top.
    var offset = function () { return parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 90; };
    var marks = !isPage ? [] : Array.prototype.map.call(document.querySelectorAll("[data-rail-mark]"), function (part) {
      var mark = document.createElement("button"), name = document.createElement("span");
      mark.type = "button"; mark.className = "rail-mark"; mark.tabIndex = -1; name.textContent = part.getAttribute("data-rail-mark");
      mark.appendChild(name); bar.appendChild(mark);
      mark.addEventListener("click", function () { window.scrollTo({ top: part.getBoundingClientRect().top + window.scrollY - offset(), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); });
      return { part: part, mark: mark };
    });
    function at() { return isPage ? window.scrollY : scroller.scrollTop; }
    function to(y) { if (isPage) window.scrollTo(0, y); else scroller.scrollTop = y; }
    var size = { track: 0, thumb: 0, max: 1 };
    function layout() {
      // A text box isn't a glass pane with room around it: the rail is laid along the box's own right edge.
      if (bar.hasAttribute("data-rail-follows")) {
        bar.style.top = scroller.offsetTop + 8 + "px"; bar.style.bottom = "auto"; bar.style.height = Math.max(0, scroller.offsetHeight - 16) + "px";
        bar.style.right = "auto"; bar.style.left = scroller.offsetLeft + scroller.offsetWidth - 22 + "px";
      }
      var whole = isPage ? document.documentElement.scrollHeight : scroller.scrollHeight, view = isPage ? window.innerHeight : scroller.clientHeight, max = whole - view;
      bar.hidden = max <= 4; if (bar.hidden) return;
      var track = bar.clientHeight, height = Math.max(36, Math.round(track * view / whole));
      size = { track: track, thumb: height, max: max };
      thumb.style.height = height + "px";
      thumb.style.transform = "translateY(" + ((track - height) * Math.min(1, at() / max)).toFixed(1) + "px)";
      marks.forEach(function (m) {
        var shown = Boolean(m.part.offsetParent); m.mark.hidden = !shown; if (!shown) return;
        var top = Math.max(0, Math.min(max, m.part.getBoundingClientRect().top + window.scrollY - offset()));
        m.mark.style.top = ((track - height) * top / max + height / 2).toFixed(1) + "px";
      });
    }
    var sleep = 0, queued = false;
    function wake() { bar.classList.add("awake"); clearTimeout(sleep); sleep = setTimeout(function () { bar.classList.remove("awake"); }, 1100); }
    (isPage ? window : scroller).addEventListener("scroll", function () { wake(); if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; layout(); }); }, { passive: true });
    window.addEventListener("resize", layout);
    if (window.ResizeObserver) new ResizeObserver(layout).observe(isPage ? document.body : scroller.firstElementChild || scroller);
    var drag = null;
    function start(event, jump) {
      event.preventDefault();
      if (jump) { var y = event.clientY - bar.getBoundingClientRect().top - size.thumb / 2; to(Math.max(0, Math.min(1, y / (size.track - size.thumb))) * size.max); }
      drag = { y: event.clientY, from: at() }; bar.classList.add("dragging");
      try { bar.setPointerCapture(event.pointerId); } catch (error) {}
    }
    thumb.addEventListener("pointerdown", function (event) { start(event, false); });
    line.addEventListener("pointerdown", function (event) { start(event, true); });
    bar.addEventListener("pointermove", function (event) { if (drag) to(drag.from + (event.clientY - drag.y) * size.max / Math.max(1, size.track - size.thumb)); });
    function end() { drag = null; bar.classList.remove("dragging"); }
    bar.addEventListener("pointerup", end); bar.addEventListener("pointercancel", end);
    layout(); wake();
  });
})();
`;

const ARROW_BACK = raw('<svg viewBox="0 0 12 16" aria-hidden="true"><path d="M12 0H7L0 8l7 8h5L5 8z"/></svg>');
const ARROW_ON = raw('<svg viewBox="0 0 12 16" aria-hidden="true"><path d="M0 0h5l7 8-7 8H0l7-8z"/></svg>');

/** Arrows to scroll a row, for a mouse or trackpad: a cut well of two halves at the right of the row's heading. Touch screens swipe instead. */
export function rowArrows(options: { rowName: string; trackId: string }): Raw {
  return html`<div class="steps" data-row-arrows><button type="button" class="step back" aria-controls="${options.trackId}" aria-label="Scroll ${options.rowName} back">${ARROW_BACK}</button><button type="button" class="step on" aria-controls="${options.trackId}" aria-label="Scroll ${options.rowName} on">${ARROW_ON}</button></div>`;
}

/** A row's arrows scroll it by most of its width, grey out at its ends, and hide when there's nothing to scroll; the row fades out softly on a side with more. */
export const ROW_SCRIPT = `/* rows */(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("[data-row-arrows]").forEach(function (steps) {
    var back = steps.querySelector(".back"), on = steps.querySelector(".on"), track = document.getElementById(back.getAttribute("aria-controls"));
    if (!track) return;
    function ends() {
      var more = track.scrollWidth - track.clientWidth, left = track.scrollLeft > 2, right = track.scrollLeft < more - 2;
      back.disabled = !left; on.disabled = !right; steps.hidden = more <= 2;
      track.classList.toggle("more-left", left); track.classList.toggle("more-right", right);
    }
    function by(direction) { track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" }); }
    back.addEventListener("click", function () { by(-1); }); on.addEventListener("click", function () { by(1); });
    track.addEventListener("scroll", ends, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(ends).observe(track); else window.addEventListener("resize", ends);
    ends();
  });
})();
`;

const standInPage = html`<div class="stand-in-page">${["Continue playing", "Popular", "New"].map((rowName, rowIndex) => html`<section><h3>${rowName}</h3><div class="stand-in-row">${Object.values(STAND_IN_COVERS).slice(rowIndex * 2, rowIndex * 2 + 4)}</div></section>`)}</div>`;
/** A header example, in a frame of its own that holds it (fixed things stay in the frame) over a stand-in page that scrolls under it. */
const headerFrame = (markup: Raw, isTall = false) => html`<div class="header-frame${isTall ? " tall" : ""}">${markup}<div class="header-scroll" data-scroll-box>${standInPage}</div></div>`;
const STAND_IN_ACCOUNT = { username: "emma_r", pictureMarkup: pictureFrame("emma_r", "md") };
const GAMES_SEARCH = { action: "#header", name: "search_text", searchText: "", placeholder: "Search games", label: "Search games" };

component({
  name: "Header",
  slug: "header",
  group: "navigation",
  summary: "The top of every page: Zaisma, where you are, search when the page has one, and you. It floats as glass and slims once the page scrolls.",
  styles: HEADER_STYLES,
  render: header,
  examples: [
    { label: "Signed out, on Home", isWide: true, markup: headerFrame(header({ id: "example-top-out", current: "home", search: GAMES_SEARCH, account: null, isOnDeveloperPage: false })) },
    { label: "Signed in, menu open", isWide: true, markup: headerFrame(header({ id: "example-top-in", current: "home", search: GAMES_SEARCH, account: STAND_IN_ACCOUNT, isOnDeveloperPage: false, isMenuOpen: true, yourGamesHref: "#header" }), true) },
    { label: "On the dashboard", isWide: true, markup: headerFrame(header({ id: "example-top-dev", current: "developer", account: STAND_IN_ACCOUNT, isOnDeveloperPage: true, yourGamesHref: "#header" })) },
    { label: "Compact, after scrolling", isWide: true, markup: headerFrame(header({ id: "example-top-compact", current: "home", search: GAMES_SEARCH, account: STAND_IN_ACCOUNT, isOnDeveloperPage: false, isCompact: true, yourGamesHref: "#header" })) },
    { label: "Logo only, on sign-in", isWide: true, markup: html`<div class="header-frame logo-frame">${header({ id: "example-top-logo", current: null, isOnDeveloperPage: false, isLogoOnly: true })}</div>` },
  ],
});

component({
  name: "Footer",
  slug: "footer",
  group: "navigation",
  summary: "The end of every page: for game developers, the forum, the source and the rules.",
  styles: `
/* The foot, at the end of the page. */
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 26px; margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }
.foot .mark { color: var(--ink); }
.foot .mark svg { height: 17px; width: auto; display: block; opacity: 0.8; }
.foot nav { display: flex; flex-wrap: wrap; gap: 6px 20px; }
.foot a { color: var(--ink-2); text-decoration: none; font: 500 14px var(--display); }
.foot nav a:hover { color: var(--ink); text-decoration: underline; text-decoration-color: var(--run); text-underline-offset: 4px; text-decoration-thickness: 2px; }
.foot a:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.foot p { margin: 0 0 0 auto; }
@media (max-width: 760px) { .foot p { margin: 0; } }
`,
  render: footer,
  examples: [{ label: "On glass", isWide: true, markup: html`<div class="glass example-wide" data-glass data-glass-corners="18 9 18 9">${footer()}</div>` }],
});

component({
  name: "Rail",
  slug: "rail",
  group: "navigation",
  summary: "Zaisma's own scrollbar, for a mouse or trackpad. It rests faintly and wakes while things move. Touch screens keep their own.",
  styles: `
/* Zaisma's own scrollbar (mouse and trackpad): a hairline with a slim glass thumb that wakes while it moves.
   In a box it runs down the inside of the box's right edge; for the page, down the page's right gutter. */
.own-scroll { scrollbar-width: none; }
.own-scroll::-webkit-scrollbar { display: none; }
.rail { display: none; position: absolute; z-index: 6; right: 8px; top: 30px; bottom: 30px; width: 14px; opacity: 0.6; transition: opacity 0.35s; }
.rail.is-on { display: block; }
.glass > .rail { position: absolute; z-index: 6; }
.rail[data-rail="page"] { position: fixed; z-index: 12; right: 0; top: 90px; bottom: 14px; }
.rail[hidden] { display: none; }
.rail.awake, .rail:hover, .rail.dragging { opacity: 1; }
.rail-line { position: absolute; inset: 0; cursor: pointer; background: linear-gradient(90deg, transparent 6px, var(--rail-line) 6px, var(--rail-line) 7px, transparent 7px); }
.rail-thumb { position: absolute; top: 0; left: 4px; width: 5px; cursor: grab; background: var(--rail-thumb); box-shadow: inset 1px 0 0 var(--rail-edge), 0 2px 6px rgba(10,20,40,0.18);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); clip-path: polygon(0 4px, 4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%);
  transition: left 0.2s, width 0.2s, background 0.2s; }
.rail:hover .rail-thumb, .rail.dragging .rail-thumb { left: 2px; width: 9px; clip-path: polygon(0 5px, 5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%); }
.rail.dragging .rail-thumb { cursor: grabbing; box-shadow: inset 2px 0 0 var(--run), 0 2px 8px rgba(10,20,40,0.22); }
/* A mark per part of the page: a short tick on the line that turns orange when pointed at. Pointing anywhere on the rail opens every mark's name on a small glass label to its left. */
/* Its click area is far bigger than the tick: 24px tall and reaching in over the page, so a mark is easy to hit. */
.rail-mark { position: absolute; left: -12px; width: 26px; height: 24px; margin-top: -12px; padding: 0; border: 0; cursor: pointer; background: none; }
.rail-mark::before { content: ""; position: absolute; left: 15px; right: 2px; top: 11px; height: 2px; background: var(--rail-mark); transition: background 0.2s, left 0.2s; }
.rail-mark:hover::before { background: var(--run); left: 9px; }
.rail-mark[hidden] { display: none; }
.rail-mark span { position: absolute; right: 28px; top: 50%; transform: translate(4px, -50%); padding: 4px 10px; white-space: nowrap; pointer-events: none;
  font: 600 12px var(--display); color: var(--ink); background: var(--glass-menu); -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); opacity: 0; transition: opacity 0.15s, transform 0.15s; }
.rail:hover .rail-mark span, .rail.dragging .rail-mark span { opacity: 1; transform: translate(0, -50%); }
/* In the narrow layout (a small window with a mouse), the page's bar fits in the 10px gutter beside the glass and starts below the header. */
@media (max-width: 760px) {
  .rail[data-rail="page"] { width: 10px; top: calc(132px + env(safe-area-inset-top, 0px)); bottom: 10px; }
  .rail[data-rail="page"] .rail-line { background: linear-gradient(90deg, transparent 4.5px, var(--rail-line) 4.5px, var(--rail-line) 5.5px, transparent 5.5px); }
  .rail[data-rail="page"] .rail-thumb { left: 3px; width: 4px; clip-path: polygon(0 3px, 3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%); }
  .rail[data-rail="page"]:hover .rail-thumb, .rail[data-rail="page"].dragging .rail-thumb { left: 2px; width: 6px; clip-path: polygon(0 4px, 4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%); }
  /* …and no marks. */
  .rail-mark, .rail-mark[hidden] { display: none; }
}
`,
  render: rail,
  examples: [
    {
      label: "In a box",
      markup: html`<div class="glass rail-box" data-glass data-glass-corners="18 9 18 9"><div class="rail-box-in"><p>${"Wander a forest that grows around you. No combat and no timers: climbing, finding and listening. ".repeat(14)}</p></div>${rail("box")}</div>`,
    },
  ],
});

component({
  name: "Row arrows",
  slug: "row-arrows",
  group: "navigation",
  summary: "Scrolling a row of games with a mouse or trackpad. They grey out at the row's ends; touch screens swipe instead.",
  styles: `
/* Arrows to scroll a row, for a mouse or trackpad: small cut glass buttons at the right of the row's heading. Touch screens swipe instead. */
.steps { margin-left: auto; display: none; gap: 2px; height: 36px; padding: 3px; background: var(--well); box-shadow: var(--well-shade);
  clip-path: polygon(9px 0, 100% 0, calc(100% - 9px) 100%, 0 100%); }
@media (hover: hover) and (pointer: fine) { .steps { display: flex; } .steps[hidden] { display: none; } }
.step { width: 46px; height: 30px; display: grid; place-items: center; border: 0; cursor: pointer; color: var(--ink-2); background: transparent;
  clip-path: polygon(7px 0, 100% 0, calc(100% - 7px) 100%, 0 100%); transition: background 0.15s, color 0.15s, opacity 0.15s, box-shadow 0.15s; }
.step svg { width: 10px; height: 13px; fill: currentColor; transition: transform 0.2s cubic-bezier(.2,.8,.2,1); }
.step:hover:not(:disabled) { background: var(--slab); color: var(--ink); box-shadow: inset 0 -3px 0 var(--run); }
.step.back:hover:not(:disabled) svg { transform: translateX(-2px); }
.step.on:hover:not(:disabled) svg { transform: translateX(2px); }
.step:active:not(:disabled) { background: var(--btn); }
.step:focus-visible { outline: none; background: var(--slab); color: var(--ink); box-shadow: inset 0 -3px 0 var(--ink); }
.step:disabled { opacity: 0.3; cursor: default; }
/* A row scrolls sideways, a little in from its glass's rim, so covers never touch the frame. Where more covers carry on, that edge fades out softly. */
.track { --fade-l: 0px; --fade-r: 0px; display: flex; gap: 16px; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; scroll-padding-inline: 8px;
  padding: 10px 8px 6px; margin: -10px -8px -6px;
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent 100%); }
.track.more-left { --fade-l: 56px; }
.track.more-right { --fade-r: 56px; }
.track::-webkit-scrollbar { display: none; }
.track > .cover { flex: 0 0 236px; scroll-snap-align: start; }
.row-head { display: flex; align-items: center; gap: 16px; margin-bottom: 4px; min-height: 36px; }
.row-head h2 { margin: 0; font: 600 22px var(--display); white-space: nowrap; color: var(--ink); }
@media (max-width: 760px) { .track { gap: 12px; } .track.more-left { --fade-l: 32px; } .track.more-right { --fade-r: 32px; } .track > .cover { flex-basis: 64vw; } .row-head h2 { font-size: 20px; } }
`,
  render: rowArrows,
  examples: [
    {
      label: "A row, at its start",
      isWide: true,
      markup: html`<div class="glass example-wide" data-glass data-glass-corners="18 9 18 9"><section class="row"><div class="row-head"><h2>Popular</h2>${rowArrows({ rowName: "Popular", trackId: "example-track" })}</div><div class="track" id="example-track">${Object.values(STAND_IN_COVERS)}</div></section></div>`,
    },
  ],
});

export interface SidebarItem {
  label: string;
  href: string;
  /** The page you're on: the white slab with the orange line. */
  isCurrent?: boolean;
  /** Before the label; the only thing a collapsed sidebar shows, so give every item one when it can collapse. */
  icon?: IconName;
  /** A small number on the item's end, like unread topics. */
  badgeCount?: number;
  /** Attributes of the link's own, like a data attribute a script reads. */
  extra?: Raw;
}

export interface SidebarOptions {
  /** What the list is, for a screen reader: "Groups". */
  label: string;
  /** Each group has a quiet heading of its own, or none. */
  groups: { heading?: string; items: SidebarItem[] }[];
  /** Only the icons, in a narrow column; the labels move to each item's title. */
  isCollapsed?: boolean;
}

/** The sidebar: a pane of glass down the side of a page, a list of the places in it. The page you're on is a white slab with an orange line, like a tab. */
export function sidebar(options: SidebarOptions): Raw {
  const link = (each: SidebarItem) => {
    const inside = each.icon ? html`${icon(each.icon)}<span class="sidebar-label">${each.label}</span>` : html`${each.label}`;
    return html`<li><a href="${each.href}"${each.extra ?? ""}${each.isCurrent ? raw(' aria-current="page"') : ""}${options.isCollapsed ? html` title="${each.label}" aria-label="${each.label}"` : ""}>${inside}${each.badgeCount ? html`<span class="sidebar-count">${each.badgeCount}</span>` : ""}</a></li>`;
  };
  const groups = options.groups.map((group) => html`<div class="sidebar-group">${group.heading ? html`<h2 class="sidebar-heading">${group.heading}</h2>` : ""}<ul>${group.items.map(link)}</ul></div>`);
  return html`<aside class="sidebar glass${options.isCollapsed ? " is-collapsed" : ""}" data-glass data-glass-corners="14 6 14 6"><nav class="sidebar-in" aria-label="${options.label}">${groups}</nav></aside>`;
}

const SIDEBAR_EXAMPLE_GROUPS: SidebarOptions["groups"] = [
  { items: [{ label: "Home", href: "#sidebar", icon: "play", isCurrent: true }, { label: "Your games", href: "#sidebar", icon: "person", badgeCount: 3 }, { label: "Friends", href: "#sidebar", icon: "friends" }] },
  { heading: "Developers", items: [{ label: "Dashboard", href: "#sidebar", icon: "code" }, { label: "Forum", href: "#sidebar", icon: "mail", badgeCount: 12 }, { label: "Settings", href: "#sidebar", icon: "gear" }] },
];

component({
  name: "Sidebar",
  slug: "sidebar",
  group: "navigation",
  summary: "A glass column down the side of a page: the places in it, in groups, with the one you're on marked. It narrows to icons in tight spaces; on a phone, pages swap it for tabs.",
  styles: `
/* The sidebar: a glass pane holding a list. Each place is a slanted tab; the current one is a white slab with an orange line. */
.sidebar { position: relative; display: flex; flex: 1; min-height: 0; width: 100%; }
.sidebar-in { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 24px 14px 14px; display: grid; gap: 14px; align-content: start; }
.sidebar-group ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.sidebar-heading { margin: 0 0 6px; padding: 0 14px; font: 500 13px var(--display); color: var(--muted); }
.sidebar a { position: relative; display: flex; align-items: center; gap: 10px; height: 42px; padding: 0 14px; font: 500 16px var(--display); color: var(--ink-2); text-decoration: none;
  clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); background: var(--wash-rest); transition: background 0.15s, color 0.15s, box-shadow 0.2s; }
.sidebar a svg { width: 18px; height: 18px; flex: none; }
.sidebar a:hover { background: var(--wash); color: var(--ink); }
.sidebar a:active { background: var(--wash-press); }
.sidebar a[aria-current="page"], .sidebar a[aria-current="page"]:hover { background: var(--slab); color: var(--ink); font-weight: 600; }
/* The current place is outlined in full orange, following the slanted cut. */
.sidebar a[aria-current="page"]::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: var(--run);
  clip-path: polygon(evenodd, 8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%, 8px 0, 10.4px 2px, calc(100% - 2px) 2px, calc(100% - 10.4px) calc(100% - 2px), 2px calc(100% - 2px), 10.4px 2px); }
.sidebar a:focus-visible { outline: 2px solid var(--ink); outline-offset: -3px; }
.sidebar-count { margin-left: auto; min-width: 22px; padding: 1px 7px; text-align: center; font: 600 12px var(--display); color: var(--ink-2); background: var(--well); box-shadow: var(--well-shade);
  clip-path: polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%); }
.sidebar.is-collapsed { flex: none; width: 72px; }
.sidebar.is-collapsed .sidebar-in { padding: 14px 10px; }
.sidebar.is-collapsed a { justify-content: center; padding: 0; }
.sidebar.is-collapsed .sidebar-label, .sidebar.is-collapsed .sidebar-count { display: none; }
.sidebar.is-collapsed .sidebar-heading { height: 1px; margin: 0 14px 6px; padding: 0; overflow: hidden; font-size: 0; background: var(--line); }
`,
  render: sidebar,
  examples: [
    { label: "Groups, with counts", markup: html`<div style="width:min(260px,100%)">${sidebar({ label: "Example places", groups: SIDEBAR_EXAMPLE_GROUPS })}</div>` },
    { label: "Collapsed to icons", markup: sidebar({ label: "Example places, collapsed", groups: SIDEBAR_EXAMPLE_GROUPS, isCollapsed: true }) },
    { label: "Plain list", markup: html`<div style="width:min(260px,100%)">${sidebar({ label: "Example groups", groups: [{ items: ["Foundations", "Actions", "Inputs", "Navigation"].map((label, tabIndex) => ({ label, href: "#sidebar", isCurrent: tabIndex === 1 })) }] })}</div>` },
  ],
});
