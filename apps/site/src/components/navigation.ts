import { accountPicture, html, raw, type Raw } from "../markup.ts";
import { pageScript } from "../page-scripts.ts";
import { component } from "./component.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { CUT_LINE, EDGE, RAIL_PARTS, divider, floatingPane, glassPane, icon, logo, railMarkup, sheetMarkup, tag, type IconName } from "./foundations.ts";
import { tabIconsAlone } from "./switch.ts";
import { HEADER_RAIL_MEDIA, cutPolygon } from "./tokens.ts";
import { action, iconAloneFace, secondaryButton, tertiaryButton, primaryButton, textLink, type ListedIcon } from "./actions.ts";
import { SEARCH_STAND_IN, searchField, tabSwitch, type SearchFieldOptions, type SwitchTab } from "./inputs.ts";
import { DROPDOWN_CHOICE_CLASS, DROPDOWN_TICK, STAND_IN_COVERS, dropdown, type DropdownItem } from "./panes.ts";
import { listRows, stateNote } from "./data.ts";
import { LOAD_FAILED_TEXT, loadMore, type LoadMoreOptions } from "./load-more.ts";
import { grid, row, stack, track, type GridItem, type LayoutItem, stackOfOne } from "./layout.ts";
export { loadMore, type LoadMoreOptions };

/*
 * Navigation: the header (a floating slab of glass with the tabs, search and you), the footer, Zaisma's own
 * scrollbar. From the header draft (ops docs/drafts/look-and-voice/header.html) and the home draft.
 */

export type HeaderTab = "home" | "browse" | "your-games" | "developer" | "forum";

export interface HeaderOptions {
  /** The tab of the page you're on, or none (like sign-in). */
  current: HeaderTab | null;
  /** The page's own search; without it the header has none. */
  search?: SearchFieldOptions;
  /** The search shows only where it's a field, so on a phone and an iPad the tabs have its room: a developer page's game search. */
  isSearchOnComputerOnly?: boolean;
  /** The signed-in account, or none: then the header says Sign in. */
  account?: { username: string } | null;
  /** The dashboard and the forum: the Developer and Forum tabs open out of the end of the tabs. */
  isOnDeveloperPage: boolean;
  /** Sign-in's pages: the logo alone, with no tabs and nothing at the end, so nothing leads away from signing in but the logo home. */
  isOnSignInPage?: boolean;
  /** Tabs of the page's own in place of Zaisma's (the admin pages'). */
  ownTabs?: SwitchTab[];
  /** Where Your games is: the tab shows, for guests too (their games on this device). */
  yourGamesHref?: string;
  /** The page shows its own runner (a game's Play, a form's Save), so Sign in is a secondary button: one runner in view. */
  hasPageRunner?: boolean;
  /** Fixed slim, as after scrolling: the gallery's state. */
  isCompact?: boolean;
  /** Waiting on the next page, its bottom edge filling with light: the gallery's state (HEADER_SCRIPT sets it on a page). */
  isWaiting?: boolean;
  /** The account menu starts open: the gallery's state. */
  isMenuOpen?: boolean;
  /** On a phone, the search starts open in place of the tabs: the gallery's state. */
  isSearchOpen?: boolean;
  /** Unique on the page, for the menu's id. Defaults to "top". */
  id?: string;
  /** The page's sidebar button (sidebarButton: a small Secondary button), at the header's start, over the sidebar it folds. */
  sidebarButton?: ControlMarkup;
  /** Back at the header's start, before Zaisma, there from the first paint: a game's page. It goes Home, and reached from another Zaisma page in this tab, back to that page as it was (HEADER_SCRIPT). */
  hasBackButton?: boolean;
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
    { ...tab(action("home").label, "/", options.current === "home"), icon: action("home").icon },
    { ...tab(action("browse").label, "/games", options.current === "browse"), icon: action("browse").icon },
    ...(options.yourGamesHref ? [{ ...tab(action("yourGames").label, options.yourGamesHref, options.current === "your-games"), icon: action("yourGames").icon }] : []),
    { ...tab(action("developer").label, account ? "/dashboard" : "/developers", options.current === "developer", true, isOpen), icon: action("developer").icon },
    { ...tab(action("forum").label, "/forum", options.current === "forum", true, isOpen), icon: action("forum").icon },
  ];
  const hasTabRow = !options.isOnSignInPage && tabs.filter((each) => !each.isFolded).length >= 2;
  const states = [hasTabRow ? "has-tab-row" : "", options.isCompact ? "is-compact" : "", options.isSearchOpen ? "searching" : "", options.isSearchOnComputerOnly ? "search-on-computer" : "", options.isWaiting ? "is-waiting" : ""].filter(Boolean).map((name) => ` ${name}`).join("");
  // Beside Back on a phone there's room for its icon alone, so a guest on a shared link keeps the tabs.
  const signIn = options.hasPageRunner
    ? secondaryButton(action("signIn"), { href: "/signin", dataAttributes: { "sign-in-icon": "", ...(options.hasBackButton ? { "sign-in-narrows": "" } : {}) } })
    : primaryButton(action("signIn"), { href: "/signin", isArrowKept: true, dataAttributes: { "sign-in-icon": "" } });
  return html`<header class="top bar-layout glass glass-bar pinned${states}" id="${id}" data-compacts data-glass data-glass-corners="header"${options.isCompact ? raw(" data-stays-compact") : ""}${options.isWaiting ? raw(" data-stays-waiting") : ""}>${EDGE}
  ${options.hasBackButton ? secondaryButton(action("back"), { staysSecondaryBecause: "It sits with the header's other controls, where a bare icon would look out of place.", id: `${id}-back`, href: "/", isLabelHidden: true, isSmall: true, dataAttributes: { "header-back": "" } }) : ""}${options.sidebarButton ?? ""}${wordmark}${hasTabRow ? logo("mark") : ""}
  ${options.isOnSignInPage ? "" : html`<nav class="nav" aria-label="Main"${hasTabRow ? "" : raw(" hidden")}>${tabSwitch({ label: "Where you are", switchSize: "regular", isFull: true, tabs })}</nav>`}
  ${options.search ? html`${searchField({ ...options.search, id: options.search.id ?? `${id}-find` })}${secondaryButton(action("search", options.search.label), { type: "button", isLabelHidden: true, isSmall: true, isExpanded: Boolean(options.isSearchOpen) })}` : ""}
  ${options.isOnSignInPage ? "" : html`<div class="end">${
    account ? accountButton({ username: account.username, menuId, isMenuOpen: options.isMenuOpen }) : signIn
  }</div>`}
</header>${account ? accountMenu(account.username, menuId, options.isMenuOpen) : ""}`;
}

/** The account menu your picture opens: it names you, then your places and Sign out. */
function accountMenu(username: string, menuId: string, isOpen = false): Raw {
  const items: DropdownItem[] = [
    { ...action("yourProfile"), href: `/@${username}` },
    { ...action("friends"), href: "/friends" },
    { ...action("developer"), href: "/dashboard" },
    { ...action("settings"), href: "/account" },
    { kind: "rule" },
    { ...action("signOut"), action: "/signout" },
  ];
  return dropdown({ id: menuId, label: "Your account", head: { title: username, note: "Online" }, items, isOpen });
}

export interface AccountButtonOptions {
  username: string;
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
  return html`<button type="button" class="shell me${options.state ? ` ${options.state}` : ""}" aria-expanded="${options.isMenuOpen ? "true" : "false"}" aria-controls="${options.menuId}" aria-label="Your account, ${options.username}"><span class="slab holds-art" data-cut-line="10">${CUT_LINE}${accountPicture(options.username, "md", { title: "" })}</span></button>`;
}

/**
 * A small screen, where the header clears the notch and a page's search that's for computers goes: below 64em, so an iPad, a phone on its side,
 * and a laptop with the browser's text at 200%. In em, which media queries take from the browser's text size. How the header's pieces
 * give way is decided by its own room, not the screen's (HEADER_FIT_SCRIPT).
 */
export const HEADER_SMALL_SCREEN_MEDIA = "(max-width: 64em)";

/** Sign in as its icon alone: the row's room is gone with its words, which keep their own padding everywhere else. */
const signInIconAlone = (signIn: string) => `  ${signIn} > .face > .ico { display: block; }
  ${iconAloneFace(`${signIn} > .face`)}
  ${signIn} > .face { justify-content: center; }
  ${signIn} > .face > :is(span:not([class]), .arrow) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }`;

const HEADER_STYLES = `
/* The header's height, on every screen, for the page under it to clear (html.ts's --header-room): one row of regular controls inside its inset. */
:root { --header-height: calc(var(--control-height-regular) + 2 * var(--pad-frame)); }
/* The header: a floating slab of the sign-in's glass, cut corners and a drawn rim, over the page. Orange only on what you act on.
   It's adaptive glass: --glass-top sets its tint and thickness, and smoked glass (dark, or .smoke) gives it light words. */
.top {
  position: fixed; z-index: 10; top: var(--pad-pane); left: 50%; transform: translateX(-50%);
  width: min(var(--size-page-wide), calc(100% - 2 * var(--pad-pane)));
  display: flex; align-items: center; gap: 0;
  --glass-tint: var(--glass-top);
  clip-path: ${cutPolygon("header")};
  transition: var(--glass-transition), height var(--motion-glide) var(--ease-glide), top var(--motion-glide) var(--ease-glide), transform var(--motion-glide) var(--ease-standard);
}
/* A bar of glass (materials.ts): its controls the frame gap from its edge on every side, its height theirs and that gap. Compact, once the
   page scrolls, it rises to the frame gap from the window's top; nothing in it is laid out again, and it stays smooth. */
.top.is-compact { top: var(--pad-frame); }
.top > :not(.edge) { position: relative; z-index: 3; }

/* Search is short at rest, so where you are leads the bar, and grows once it's pressed or holds words. It's never narrower than it can be used:
   with less room than that it's the search button (below). */
.top .find { flex: 0 1 var(--size-search); min-width: var(--size-search-least); transition: flex-basis var(--motion-glide) var(--ease-glide); }
.top .find:is(:has(input:focus-visible), .is-focused, :has(input:not(:placeholder-shown))) { flex-basis: var(--size-search-open); }

/* Where you are: a Switch (switch.ts), filling the room the header gives it; the header only places it.
   With fewer than two tabs to show it isn't a choice, so it's hidden (header()). */
.nav { display: flex; flex: none; min-width: 0; }
.top .nav[hidden] { display: none; }
.nav > .switch-well { flex: 1; }
/* The sidebar button at the header's start and the search button are a regular control's height, as the tabs, the search and the account
   button beside them, so they sit at the frame gap with them. */
.top > .cut-btn:is([data-sidebar-button], [data-header-back]), .top > .find + .cut-btn { --control-height: var(--control-height-regular); }

.end { display: flex; align-items: center; flex: none; }


/* Where the tabs are words the Zaisma wordmark leads, and the tabs' icons wait for a phone. */
.top > .logo.mark { display: none; }
.top .tab-switch .ico { display: none; }
.top .end > [data-sign-in-icon] > .face > .ico { display: none; }
/* The search button: a Secondary button, icon only, that swaps the tabs for the field. */
.top > .find + .cut-btn { display: none; }
/* Until what follows it has arrived it isn't whole, so it hasn't been fitted to its room (HEADER_FIT_SCRIPT, as it's whole): its glass shows, and what's on it waits, so a slow page never paints a computer's header on a phone. CSS, so it can't hold a page with no scripts; asked with :has, as :last-child doesn't match in Chrome until the whole page is read. */
body > .top:not(:has(+ *)) > :not(.edge) { visibility: hidden; }
/* As its own room runs out, the header gives way one step at a time (HEADER_FIT_SCRIPT), each keeping the one before.
   First search becomes its button, which swaps the tabs for the field. */
.top.has-search-button .find { display: none; flex: 1 1 0; min-width: 0; max-width: none; }
.top.has-search-button.searching .find { display: flex; }
.top.has-search-button.searching .nav { display: none; }
.top.has-search-button > .find + .cut-btn { display: inline-flex; }
.top.has-search-button.searching > .find + .cut-btn { display: none; }
/* On a phone on its side the typing bar is the search: the header stays as it is (never .searching), and the field, there only to take focus, waits out of sight. */
.top.has-search-button.typing-search .find { display: flex; }
.top.has-search-button.typing-search .find:not(.is-typing-bar) { position: fixed; top: 0; left: 0; opacity: 0; pointer-events: none; }
/* Then the tabs draw in around their words. */
.top.has-tight-tabs .tab-switch { --tab-room: var(--pad-icon); }
/* Then Zaisma is its mark and the tabs their icons, sharing the room. */
.top.has-icon-tabs.has-tab-row > .logo.wordmark { display: none; }
.top.has-icon-tabs > .logo.mark { display: flex; margin-inline: var(--pad-icon); }
.top.has-icon-tabs > :is([data-sidebar-button], [data-header-back]) { margin-right: 0; }
.top.has-icon-tabs .nav { flex: 1 1 0; }
${tabIconsAlone(".top.has-icon-tabs .tab-switch")}
${signInIconAlone(".top.has-icon-tabs .end > [data-sign-in-narrows]")}
/* Last, Sign in is its icon too (a 320 px phone). Past that the tabs scroll in their Well, as any Switch does. */
${signInIconAlone(".top.has-icon-sign-in .end > [data-sign-in-icon]")}
/* While it measures, what eases its width doesn't, so it reads what each step comes to. */
.top.is-measuring .foldable { transition: none; }
@media ${HEADER_SMALL_SCREEN_MEDIA} {
  /* The header floats on phones too: a slab of glass inset from every edge (below the notch), never touching the screen's sides. */
  .top { top: calc(var(--pad-pane) + env(safe-area-inset-top, 0px)); width: calc(100% - 2 * var(--pad-pane)); }
  .top.is-compact { top: calc(6px + env(safe-area-inset-top, 0px)); }
  .top.search-on-computer .find, .top.search-on-computer > .find + .cut-btn { display: none; }
  .top.search-on-computer .nav:has(~ .end > .me) { margin-inline-end: var(--gap-words-control); }
}
/* A phone on its side: the header stands as a rail down the left (layout.ts's bar, stood up). Zaisma's mark and the tabs' icons at the top, search
   and you at the foot. Pressing search lays it across the top again for as long as the field is open. */
@media ${HEADER_RAIL_MEDIA} {
  body > .top.has-tab-row:not(.searching) > .logo.wordmark { display: none; }
  body > .top.has-tab-row:not(.searching) > .logo.mark { display: flex; justify-content: center; }
  body > .top.has-tab-row:not(.searching) .tab-switch .ico { display: block; }
  body > .top.has-tab-row:not(.searching) .tab-switch > .foldable.folded { display: none; }
  body > .top.has-tab-row:not(.searching) .tab-switch > :is(a, button) { justify-content: center; --row-start: 0px; --row-end: 0px; }
  body > .top.has-tab-row:not(.searching) .tab-switch > :is(a, button) > span:not(.tag) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  body > .top.has-tab-row:not(.searching) .rail { display: none; }
  body > .top.has-tab-row:not(.searching) .end > [data-sign-in-icon] > .face > .ico { display: block; }
  body > .top.has-tab-row:not(.searching) .end > [data-sign-in-icon] > .face { width: auto; padding: 0; justify-content: center; }
  body > .top.has-tab-row:not(.searching) .end > [data-sign-in-icon] > .face > :is(span:not([class]), .arrow) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
/* The account menu hangs from your picture's right end, so it's never wider than the room from there back to the page's margin: the
   header's width less its inset (a phone's header is narrower than the menu's own width). */
.top + .dropdown { max-width: calc(100% - 2 * var(--pad-pane) - var(--pad-inner-pane)); }
/* On a touch screen, Sign in and your picture are small, so each takes a regular control's height to press, reaching into the header's inset
   above and below it. */
@media (pointer: coarse) {
  .top .end > .shell::after, .top .end > .me::before { content: ""; position: absolute; left: 0; right: 0; top: min(0px, calc((100% - var(--touch-target)) / 2)); bottom: min(0px, calc((100% - var(--touch-target)) / 2)); }
}

@media (prefers-reduced-motion: reduce) {
  /* The header's glass still changes as all glass does: only its movement stops. */
  .top { transition: var(--glass-transition); }
}
`;

/**
 * How the header gives way, measured from its own room, so a page and a gallery's frame of one width are the same, however many tabs it has:
 * search becomes its button, then the tabs draw in, then they're icons, then Sign in is too. It runs as the header arrives, so the first paint is right, and again
 * as its room or what's in it changes. A phone on its side stands the header up (layout.ts): always its button, with its own rules for the rest.
 */
export const HEADER_FIT_SCRIPT = `/* header fit */(function () {
  var railMedia = window.matchMedia(${JSON.stringify(HEADER_RAIL_MEDIA)}), LAST_STEP = 4;
  function takeSteps(top, stepCount) { top.classList.toggle("has-search-button", stepCount > 0); top.classList.toggle("has-tight-tabs", stepCount > 1); top.classList.toggle("has-icon-tabs", stepCount > 2); top.classList.toggle("has-icon-sign-in", stepCount > 3); }
  // The tabs' own width: from the tabs themselves, as the slab gliding from the last page's tab can reach past them for a moment, and that's no room they need.
  function tabsWidth(tabs) {
    var endPx = 0;
    Array.prototype.forEach.call(tabs.querySelectorAll(":scope > a, :scope > button"), function (tab) { endPx = Math.max(endPx, tab.offsetLeft + tab.offsetWidth); });
    return endPx + parseFloat(getComputedStyle(tabs).paddingRight);
  }
  // What its pieces come to with no room to spare (as wide as they are, so its auto margins are nothing): the field at its least, the tabs at their words' width.
  function neededWidth(top, stepCount) {
    takeSteps(top, stepCount);
    var own = getComputedStyle(top), neededPx = parseFloat(own.paddingLeft) + parseFloat(own.paddingRight);
    Array.prototype.forEach.call(top.children, function (piece) {
      var style = getComputedStyle(piece);
      if (piece.classList.contains("edge") || style.display === "none") return;
      var tabs = piece.querySelector(":scope > .switch-well .tab-switch");
      neededPx += parseFloat(style.marginLeft) + parseFloat(style.marginRight) + (piece.matches(".find") ? parseFloat(style.minWidth) : Math.max(piece.offsetWidth, tabs ? tabsWidth(tabs) : 0));
    });
    return neededPx;
  }
  function fit(top) {
    if (!top.clientWidth || (top.checkVisibility && !top.checkVisibility({ contentVisibilityAuto: true }))) return;
    if (railMedia.matches && top.matches("body > .top")) { takeSteps(top, 1); return; }
    var roomPx = top.clientWidth, needed = top.neededWidths || (top.neededWidths = []), find = top.querySelector(".find");
    var isTyping = Boolean(find) && find.contains(document.activeElement), isSearching = top.classList.contains("searching"), isMeasuring = false, stepCount = 0;
    for (; stepCount < LAST_STEP; stepCount++) {
      if (needed[stepCount] === undefined) {
        // Measuring hides the field in the steps past it, which would take the cursor out of it: what's typed in stays until it's closed.
        if (isTyping) return;
        if (!isMeasuring) { isMeasuring = true; top.classList.remove("searching"); top.classList.add("is-measuring"); top.style.width = "max-content"; }
        needed[stepCount] = neededWidth(top, stepCount);
      }
      if (needed[stepCount] <= roomPx) break;
    }
    if (isMeasuring) { top.style.width = ""; top.classList.remove("is-measuring"); if (isSearching) top.classList.add("searching"); }
    // Out of room while typing, the field stays and the tabs make way for it.
    if (isTyping && stepCount > 0 && !top.classList.contains("typing-search")) top.classList.add("searching");
    takeSteps(top, stepCount);
  }
  function wire(top) {
    if (top.fitToRoom) return;
    function measureAgain() { top.neededWidths = null; fit(top); }
    top.fitToRoom = function () { fit(top); };
    fit(top);
    window.zaismaWatch.size(top, top.fitToRoom);
    var tabs = top.querySelector(".tab-switch");
    if (tabs) window.zaismaWatch.size(tabs, measureAgain);
    window.zaismaWatch.fontsIn(measureAgain);
    railMedia.addEventListener("change", measureAgain);
  }
  window.zaismaWatch.each("header.top", wire);
  // The page's own header, the moment what follows it has arrived: the rest of a slow page can take a while, and a phone may paint before it does.
  window.zaismaWatch.arriving(function () { var top = document.querySelector("body > header.top"); if (top && top.nextSibling) wire(top); });
})();
`;

/**
 * The header's own behavior: it slims once the page scrolls (the gallery's frames scroll a box of their own,
 * [data-scroll-box]), the slab sits under the current page and a faint one follows the pointer, "/" jumps to search,
 * the search button swaps the tabs for the field, and the developer tabs open or fold from where the last page left them.
 * The menu is DROPDOWN_SCRIPT's.
 */
export const HEADER_SCRIPT = pageScript(
  "header",
  `(function () {
  var smallScreen = window.matchMedia(${JSON.stringify(HEADER_SMALL_SCREEN_MEDIA)});
  var headers = Array.prototype.slice.call(document.querySelectorAll("header.top"));
  /* Back is a link Home. Reached from another Zaisma page in this tab, and through a reload or Leave, it goes back to that page as it was instead. Sign-in's pages are no place to go back to. */
  var backButton = document.querySelector("[data-header-back]");
  if (backButton) {
    var backKey = "zaisma-back:" + location.pathname, navigation = performance.getEntriesByType("navigation")[0], from = null;
    try { from = document.referrer ? new URL(document.referrer) : null; } catch (error) { /* no address, no way back */ }
    var isFromHere = from && from.origin === location.origin && from.pathname === location.pathname;
    var isFromZaisma = from && from.origin === location.origin && !/^\\/(signin|join|signout)/.test(from.pathname);
    var hasWayBack = false;
    try {
      if ((!navigation || navigation.type === "navigate") && !isFromHere) { if (isFromZaisma) sessionStorage.setItem(backKey, "1"); else sessionStorage.removeItem(backKey); }
      hasWayBack = sessionStorage.getItem(backKey) === "1" && history.length > 1;
    } catch (error) { /* no note, no way back */ }
    if (hasWayBack) backButton.addEventListener("click", function (event) { event.preventDefault(); history.back(); });
  }
  headers.forEach(function (top) {
    /* Once the page scrolls, the slab gets slimmer and everything in it shrinks to fit (COMPACT_SCRIPT, data-compacts). */

    /* Where you are is a framed Switch, which moves its own slab (SWITCH_SCRIPT). */

    /* Search: with too little room for the field, the search button swaps the tabs for it. */
    var search = top.querySelector('.find input[type="search"]'), findOpen = top.querySelector(".find + .cut-btn"), sideways = window.matchMedia("(orientation: landscape) and (max-height: 500px) and (pointer: coarse)");
    top.openSearch = function () { if (!search || (smallScreen.matches && top.classList.contains("search-on-computer"))) return; top.classList.add(sideways.matches ? "typing-search" : "searching"); if (findOpen) findOpen.setAttribute("aria-expanded", "true"); search.focus(); };
    top.closeSearch = function () { top.classList.remove("searching", "typing-search"); if (findOpen) findOpen.setAttribute("aria-expanded", "false"); if (top.fitToRoom) top.fitToRoom(); };
    if (findOpen) findOpen.addEventListener("click", function () { if (top.classList.contains("searching") || top.classList.contains("typing-search")) top.closeSearch(); else top.openSearch(); });
    if (search) search.addEventListener("blur", function () { if (top.classList.contains("has-search-button") && !search.value && !sideways.matches) setTimeout(top.closeSearch, 120); });
    document.addEventListener("typing-bar-lowered", function () { if (top.classList.contains("typing-search") && (document.activeElement !== search || !sideways.matches)) top.closeSearch(); });
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
  /* A tap or click that opens another page of this site holds what was pressed pressed (is-pressed) until the page goes, and after half a
     second, a page that wasn't prepared ahead, the header's bottom edge fills with light (is-waiting): a link in this tab, not a new tab, a
     download or a place on this same page. A prepared page comes before the light would. Back from the browser's history, it's dark again. */
  var waitingTimer = 0, pressedLink = null;
  function setWaiting(isWaiting) {
    clearTimeout(waitingTimer);
    if (!isWaiting && pressedLink) { pressedLink.classList.remove("is-pressed"); pressedLink = null; }
    // Every bar of header glass, the gallery's too: the line is the glass's own (.glass-bar).
    document.querySelectorAll("header.glass-bar").forEach(function (bar) { if (!bar.hasAttribute("data-stays-waiting")) bar.classList.toggle("is-waiting", isWaiting); });
  }
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[href]");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    var to = new URL(link.href, location.href);
    if (to.origin !== location.origin || (to.pathname === location.pathname && to.search === location.search)) return;
    // Checked once every handler has run: a link a page script handles itself (Load more) waits on its own edge instead.
    setTimeout(function () {
      if (event.defaultPrevented) return;
      setWaiting(false);
      pressedLink = link;
      link.classList.add("is-pressed");
      waitingTimer = setTimeout(function () { setWaiting(true); }, 500);
    }, 0);
  });
  // A stacked switch moves on the press and opens the next page itself (SWITCH_SCRIPT), so its links say so here: its slab is what stays pressed.
  document.addEventListener("zaisma-leaving-page", function () {
    setWaiting(false);
    waitingTimer = setTimeout(function () { setWaiting(true); }, 500);
  });
  window.addEventListener("pageshow", function () { setWaiting(false); });
  window.addEventListener("pagehide", function () { setWaiting(false); });
  /* "/" anywhere jumps to the header's search; Escape puts the phone's tabs back. */
  document.addEventListener("keydown", function (event) {
    var top = headers.filter(function (each) { return each.querySelector(".find") && each.offsetParent !== null; })[0];
    if (!top) return;
    if (event.key === "/" && !/^(input|textarea|select)$/i.test(event.target.tagName) && !event.target.isContentEditable) { event.preventDefault(); top.openSearch(); }
    if (event.key === "Escape" && (top.classList.contains("searching") || top.classList.contains("typing-search"))) top.closeSearch();
  });
})();
`,
);

/** The links at the foot of every page: what Zaisma is and its rules. */
const FOOTER_LINKS: [string, string][] = [["For game developers", "/dashboard"], ["Forum", "/forum"], ["Source code", "https://github.com/zaisma/zaisma"]];
const FOOTER_RULES_LINKS: [string, string][] = [["Content rules", "/legal/content-rules"], ["Terms", "/legal/terms"], ["Privacy", "/legal/privacy"], ["Security", "/legal/security"], ["DMCA", "/legal/dmca"], ["Defamation", "/legal/defamation"], ["Trademark", "/legal/trademark"]];

export function footer(): Raw {
  return html`<footer class="foot glass glass-bar" data-glass data-glass-corners="header">${EDGE}<div class="foot-in words-margin round">
  ${logo("mark")}
  <nav class="foot-links" aria-label="More from Zaisma"><div class="foot-group is-own">${FOOTER_LINKS.map(([words, href]) => textLink(words, href, { isQuiet: true }))}</div><div class="foot-group">${FOOTER_RULES_LINKS.map(([words, href]) => textLink(words, href, { isQuiet: true }))}</div></nav>
</div></footer>`;
}

/**
 * Zaisma's own scrollbar: "page" for the page, "box" for a box that scrolls up and down, "side" for one that scrolls sideways (put it just
 * after that box; a box marked data-side-rail gets one by itself).
 */
export function rail(scrollKind: "box" | "page" | "side"): Raw {
  return railMarkup(scrollKind);
}

/**
 * A scrollbar of Zaisma's own, on every device: a channel carved down the box (or along it, or down the page's gutter) with a slab of the
 * glass sliding in it. It keeps the frame gap from the edges of the glass it runs in, and where it reaches a corner its end is cut along it.
 * It wakes while it moves and rests faintly otherwise. Drag the thumb, or press the rail to jump; wheel, keys and touch scroll as always.
 * It hides itself when there's nothing to scroll.
 * The page's rail has a mark for each part of the page marked data-rail-mark="<its name>" (the home's rows):
 * point at one for its name, click it to go there.
 */
export const RAIL_SCRIPT = `/* rail */(function () {
  /*
   * Rails are laid out together, once a frame, in steps that read the page and then write it: every rail's place is read and then set, then
   * every rail's track and marks are read, then every thumb and mark is set. So a page full of rails reads its layout twice a frame, not a
   * few times for every rail. The first is laid out before the page's first paint, as the browser runs a frame's work before painting it.
   */
  var dueRails = new Set(), isRailFrameAsked = false;
  function layOutSoon(rail) {
    dueRails.add(rail);
    if (isRailFrameAsked) return;
    isRailFrameAsked = true;
    requestAnimationFrame(function () {
      isRailFrameAsked = false;
      var rails = Array.from(dueRails); dueRails.clear();
      var places = rails.map(function (rail) { return rail.place(); });
      rails.forEach(function (rail, i) { rail.putPlace(places[i]); });
      // A rail that has just come on was measured while it wasn't shown (no offsetParent, so no place): it's placed again now, in this same
      // frame, so it's never drawn for a frame at its corner of the box before it's where it belongs.
      var unplaced = rails.filter(function (rail, i) { return rail.isUnplaced(places[i]); });
      var replaces = unplaced.map(function (rail) { return rail.place(); });
      unplaced.forEach(function (rail, i) { places[rails.indexOf(rail)] = replaces[i]; rail.putPlace(replaces[i]); });
      var measures = rails.map(function (rail, i) { return rail.measure(places[i]); });
      rails.forEach(function (rail, i) { rail.put(places[i], measures[i]); });
    });
  }
  // Any box that scrolls up and down gets its rail by itself, so a new component never has to remember one. A box that
  // hides its scrollbar on purpose (scrollbar-width: none) keeps it hidden. A text box or list box gets one too, laid over its own edge.
  // Every box's style is read before any rail goes in: a rail put in between would make the next read work out the whole page's styles
  // again, once a box (a page of fields has over a hundred).
  // A box's rails follow it, one of each kind at most: a table that scrolls both ways has its up-down one and its sideways one.
  function railAfter(box, kind) {
    for (var next = box.nextElementSibling; next && next.hasAttribute("data-rail"); next = next.nextElementSibling) if (next.getAttribute("data-rail") === kind) return true;
    return false;
  }
  function addRails(scrollBoxes, within) {
    var railedBoxes = scrollBoxes.map(function (box) {
      var isControl = box.tagName === "TEXTAREA" || (box.tagName === "SELECT" && (box.multiple || box.size > 1));
      if ((/^(SELECT|INPUT)$/.test(box.tagName) && !isControl) || railAfter(box, "box")) return null;
      // A box with Zaisma's sideways rail (data-side-rail) hides the browser's bars for its own, so it takes its own up-down one too. So does
      // one marked own-scroll in its markup: that's the browser's bar gone before the rail comes, not a box asking for none.
      if ((getComputedStyle(box).scrollbarWidth === "none" && !box.hasAttribute("data-side-rail") && !box.classList.contains("own-scroll")) || box.classList.contains("rail-thumb")) return null;
      var parent = box.parentElement; if (!parent || parent === document.body) return null;
      return { box: box, isControl: isControl, isParentStatic: getComputedStyle(parent).position === "static" };
    });
    railedBoxes.forEach(function (railed) {
      if (!railed) return;
      if (railed.isParentStatic) railed.box.parentElement.style.position = "relative";
      railed.box.insertAdjacentHTML("afterend", '<div class="rail" data-rail="box" aria-hidden="true">${RAIL_PARTS}</div>');
    });
    // A box that scrolls sideways and asks for it (data-side-rail: a table, a chart) gets the same rail laid on its side, under it: shown on
    // phones too, whose own sideways scrollbars hide.
    within.querySelectorAll("[data-side-rail]").forEach(function (box) {
      if (railAfter(box, "side")) return;
      box.insertAdjacentHTML("afterend", '<div class="rail sideways" data-rail="side" aria-hidden="true">${RAIL_PARTS}</div>');
    });
  }
  var wiredBars = new WeakSet(), isPageRailWaiting = false;
  // Each rail is wired once: the page's, those of the boxes found at the start and those of boxes added later.
  function wireRails() {
  document.querySelectorAll("[data-rail]").forEach(function (bar) {
    if (wiredBars.has(bar)) return;
    // The page's rail comes first in its body: the browser's own scrollbar goes at once, so it never takes its room for a moment, and the
    // rail is wired once the page is read, when the parts it marks and the header it starts below are there.
    if (bar.getAttribute("data-rail") === "page" && document.readyState === "loading") { document.documentElement.classList.add("own-scroll"); if (!isPageRailWaiting) { isPageRailWaiting = true; window.zaismaWatch.whenRead(wireRails); } return; }
    wiredBars.add(bar);
    var isPage = bar.getAttribute("data-rail") === "page", isSide = bar.getAttribute("data-rail") === "side", scroller = isPage ? null : bar.previousElementSibling;
    while (scroller && scroller.hasAttribute("data-rail")) scroller = scroller.previousElementSibling;
    // A box laid out round what scrolls (a switch's well round its tabs) names it: the rail goes under the box, and follows what's in it.
    // Only its own: a box that scrolls itself and holds such a box further in (a pane with a switch in it) keeps its own rail.
    if (scroller && !scroller.matches("[data-rail-scroller]")) scroller = scroller.querySelector(":scope > [data-rail-scroller]") || scroller;
    if (!isPage && !scroller) return;
    var groove = bar.querySelector(".rail-groove"), thumb = bar.querySelector(".rail-thumb");
    // Its reach (the width a pointer finds it in) and its channel's width, centered in it.
    var css = getComputedStyle(bar), reachPx = parseFloat(css.getPropertyValue("--rail-reach")) || 16, widthPx = parseFloat(css.getPropertyValue("--rail-width")) || 10;
    // The groove sits 2px inside the channel, so its slanted ends lie 2px in from the channel's: the thumb stops this far along it, its own
    // slant flush against the groove's end.
    var SLANT_IN_PX = 2 * Math.SQRT2;
    // The page's thumb follows the page's scroll in the browser itself where it can (a scroll-driven animation): in step with a swipe and
    // with the browser's bar showing and hiding, which a script a frame behind can't be. Only its length is set here (--thumb-share).
    var followsScroll = isPage && window.CSS && CSS.supports("animation-timeline: scroll()");
    if (followsScroll) bar.classList.add("follows-scroll");
    if (isPage) document.documentElement.classList.add("own-scroll"); else scroller.classList.add("own-scroll");
    // Shown or not by its class, never by hidden: WebKit checks the page's :has() rules on [hidden] again over the whole page each time any
    // element's hidden changes, seconds on a page of a hundred boxes.
    // It starts off and comes on once it's measured as having something to scroll, in the frame before the first paint: started on, it
    // would take its room for a moment and give it back, moving what's below it (isUnplaced places one that has just come on).
    var isShown = false;
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
    // The one name that rides beside the thumb while it's dragged.
    var riding = null;
    if (parts.length) { riding = document.createElement("span"); riding.className = "tag rail-name rail-riding"; riding.setAttribute("data-cut-line", "0"); riding.appendChild(document.createElement("span")); bar.appendChild(riding); }
    // Where a part sits along the box (or the page), from its start, as the box would scroll to show it.
    function spot(part, scrollPadding) {
      if (isPage) return part.getBoundingClientRect().top + window.scrollY - (scrollPadding === undefined ? offset() : scrollPadding);
      var box = scroller.getBoundingClientRect(), r = part.getBoundingClientRect();
      return isSide ? r.left - box.left + scroller.scrollLeft : r.top - box.top + scroller.scrollTop;
    }
    var marks = parts.map(function (part) {
      var mark = document.createElement("button"), name = document.createElement("span");
      mark.type = "button"; mark.className = "rail-mark"; mark.tabIndex = -1; name.className = "tag rail-name"; name.setAttribute("data-cut-line", "0"); name.appendChild(document.createElement("span")).textContent = part.getAttribute("data-rail-mark");
      mark.appendChild(name); bar.appendChild(mark);
      mark.addEventListener("click", function () {
        // A press on the thumb where a mark lies over it took the thumb, not the mark.
        if (pressedThumb) { pressedThumb = false; return; }
        go();
      });
      function go() {
        var behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        if (isPage) window.scrollTo({ top: spot(part), behavior: behavior }); else scroller.scrollTo(isSide ? { left: spot(part), behavior: behavior } : { top: spot(part), behavior: behavior });
      }
      mark.goToPart = go;
      return { part: part, mark: mark, name: name };
    });
    // --label-shift moves a name from its mark.
    function spread(track) {
      // Only one name shows at a time (near, below): each sits by its own mark, kept inside the rail's ends.
      marks.forEach(function (m) {
        if (m.mark.hidden) return;
        var at = parseFloat(m.mark.style[isSide ? "left" : "top"]) || 0, half = (m.size || 0) / 2, center = Math.max(half, Math.min(track - half, at));
        m.restShift = (center - at).toFixed(1) + "px"; m.name.style.setProperty("--label-shift", m.restShift);
      });
    }
    // Sideways, everything below runs along x instead of y: the box's left edge, its width, the pointer's x.
    function at() { return isPage ? window.scrollY : isSide ? scroller.scrollLeft : scroller.scrollTop; }
    function to(y) { if (isPage) window.scrollTo(0, y); else if (isSide) scroller.scrollLeft = y; else scroller.scrollTop = y; }
    function along(event) { return isSide ? event.clientX : event.clientY; }
    var size = { track: 0, thumb: 0, max: 1, start: 0, startIn: SLANT_IN_PX };
    // A cut end's bevel, by the edge rule (the page's rail carves its whole width): the thumb nests into it at the groove's 2px, so its own end
    // is the groove's cut (the bevel less what the 2px gaps take off it), and where that's deeper than the thumb is thick, the thumb starts in by the rest.
    var channel = bar.querySelector(".rail-line");
    function slantInFor(isStart) {
      if (isPage) return SLANT_IN_PX;
      var cuts = channel.cutCorners || [0, 0, 0, 0], cut = isSide ? (isStart ? cuts[3] : cuts[2]) : (isStart ? cuts[1] : cuts[2]);
      return Math.max(0, cut - (4 - 2 * Math.SQRT2) - (isSide ? groove.clientHeight : groove.clientWidth));
    }
    // The page's rail starts the gutter's width below the page's floating bar (data-rail-starts-below), following it as it tightens.
    var above = isPage ? document.querySelector("[data-rail-starts-below]") : null, GUTTER_PX = 10;
    var rail = {
      // Where it sits and how much there is to scroll, read.
      place: function () {
        var placed = { whole: isPage ? document.documentElement.scrollHeight : isSide ? scroller.scrollWidth : scroller.scrollHeight, view: isPage ? window.innerHeight : isSide ? scroller.clientWidth : scroller.clientHeight };
        placed.max = placed.whole - placed.view;
        // Under the header, or the whole way down beside it where it's a rail.
        if (above) { var aboveRect = above.getBoundingClientRect(); placed.top = Math.round((aboveRect.height > aboveRect.width ? 0 : aboveRect.bottom) + GUTTER_PX) + "px"; }
        // Down a box, it runs the box's height at the right, keeping --rail-inset (the frame gap) from the edges of the glass or carving round
        // it, and never past the box itself: so it's as clear of a pane's edge as anything with an edge. Its channel's ends are square, as
        // anything in a box is by the edge rule; where the box reaches a cut corner, that end is cut, stopping where its slant keeps that
        // same gap from the corner's cut. Sideways, along a pane's foot, its ends keep the gap from the foot's corners the same way.
        if (!isPage) {
          var holder = scroller.closest("[data-glass], .carving"), parent = bar.offsetParent;
          if (holder && parent) {
            var edge = holder.getBoundingClientRect(), inset = parseFloat(getComputedStyle(holder).getPropertyValue("--rail-inset")) || 0, short = Math.min(edge.width, edge.height);
            var cuts = (holder.cutCorners || (window.zaismaCorners ? window.zaismaCorners(holder, "pane") : [0, 0, 0, 0])).map(function (cut) { return Math.min(cut, Math.round(short * 0.3)); });
            // How far from a corner's cut a slanted end has to stop: along the edge, the cut less the channel's width, plus what the gap adds on a slant.
            var slack = inset * (Math.SQRT2 - 1), fromCut = function (cut) { return Math.max(inset, cut - widthPx + slack); };
            if (isSide) {
              var own = bar.getBoundingClientRect(), shownLeft = own.left - (parseFloat(bar.style.marginLeft) || 0), shownRight = own.right + (parseFloat(bar.style.marginRight) || 0);
              var isAtFoot = edge.bottom - own.bottom <= inset + 2;
              // A box whose start never moves (a table's row heads) starts its rail past it.
              var rowHead = scroller.querySelector(":scope > table.has-row-heads > tbody > tr > th"), sideStart = rowHead ? rowHead.offsetWidth : 0, sideBox = scroller.getBoundingClientRect();
              placed.side = isAtFoot ? { left: Math.max(0, edge.left + fromCut(cuts[3]) - shownLeft, sideStart ? sideBox.left + sideStart + inset - shownLeft : 0), right: Math.max(0, shownRight - (edge.right - fromCut(cuts[2]))) } : { left: 0, right: 0 };
            } else {
              // Measured on screen, where a sheet still growing in as it opens is drawn smaller than it lays out: the gaps are drawn at
              // that size too, and what's measured is put back at the size it lays out at, so the rail lands where it will be once it's in.
              var from = parent.getBoundingClientRect(), box = scroller.getBoundingClientRect(), drawn = holder.offsetWidth ? edge.width / holder.offsetWidth : 1;
              // A box whose top never scrolls (a table's header row, as the scroll fades read it) starts its rail under it, a frame gap down.
              var head = scroller.querySelector(":scope > table > thead"), topIn = fromCut(cuts[1]), bottomIn = fromCut(cuts[2]), startsAt = head ? head.offsetHeight : 0;
              // A box with its sideways rail along its foot (a table) keeps that lane for it: this one stops a frame gap above its channel,
              // which keeps the frame gap from the foot.
              var footLane = scroller.classList.contains("shows-side-rail") && scroller.nextElementSibling && scroller.nextElementSibling.matches(".rail.sideways") ? (widthPx + 2 * inset) * drawn : 0;
              var boxTop = box.top + (startsAt ? (startsAt + inset) * drawn : 0), boxBottom = box.bottom - footLane;
              var top = Math.max(boxTop, edge.top + topIn * drawn), bottom = Math.min(boxBottom, edge.bottom - bottomIn * drawn), right = Math.min(box.right, edge.right - inset * drawn);
              placed.box = { top: (top - from.top) / drawn - parent.clientTop, height: Math.max(0, bottom - top) / drawn, left: (right - from.left) / drawn - parent.clientLeft - (reachPx + widthPx) / 2 };
            }
          }
        }
        return placed;
      },
      putPlace: function (placed) {
        if (placed.top) bar.style.top = placed.top;
        if (placed.side) { bar.style.marginLeft = placed.side.left.toFixed(1) + "px"; bar.style.marginRight = placed.side.right.toFixed(1) + "px"; }
        if (placed.box) { bar.style.top = placed.box.top.toFixed(1) + "px"; bar.style.height = placed.box.height.toFixed(1) + "px"; bar.style.left = placed.box.left.toFixed(1) + "px"; }
        if (isShown !== placed.max > 4) { isShown = placed.max > 4; bar.classList.toggle("is-on", isShown); }
        // The box makes room for its rail by this class, never by a :has() on the rail beside it, for the same reason.
        if (!isPage) scroller.classList.toggle(isSide ? "shows-side-rail" : "shows-rail", isShown);
      },
      // Shown, in a box, but given no place: it was measured hidden.
      isUnplaced: function (placed) { return !isPage && isShown && !placed.box && !placed.side; },
      // Its track, where it's scrolled to and where its marks' parts sit, read once it's placed.
      measure: function () {
        if (!isShown) return null;
        var scrollPadding = isPage && marks.length ? offset() : 0;
        return {
          // The thumb runs the groove between its ends: short of a slanted one by the slant, to a square one's very end.
          track: (isSide ? groove.clientWidth : groove.clientHeight) - slantInFor(true) - slantInFor(false),
          start: (isSide ? groove.offsetLeft + groove.parentElement.offsetLeft : groove.offsetTop + groove.parentElement.offsetTop) + slantInFor(true),
          startIn: slantInFor(true),
          at: at(),
          marks: marks.map(function (m) {
            var shown = Boolean(m.part.offsetParent);
            return shown ? { shown: true, spot: spot(m.part, scrollPadding), size: isSide ? m.name.offsetWidth : m.name.offsetHeight } : { shown: false };
          })
        };
      },
      put: function (placed, measured) {
        if (!measured) return;
        var track = measured.track, max = placed.max, height = Math.max(36, Math.round(track * placed.view / placed.whole));
        size = { track: track, thumb: height, max: max, start: measured.start, startIn: measured.startIn };
        if (followsScroll) thumb.style.setProperty("--thumb-share", (placed.view / placed.whole).toFixed(4));
        else thumb.style[isSide ? "width" : "height"] = height + "px";
        move(measured.at);
        marks.forEach(function (m, i) {
          var seen = measured.marks[i]; m.mark.hidden = !seen.shown; if (!seen.shown) return;
          var top = Math.max(0, Math.min(max, seen.spot));
          m.mark.style[isSide ? "left" : "top"] = (measured.start + (track - height) * top / max + height / 2).toFixed(1) + "px";
          // A name that was hidden has no size yet: it's read once it shows.
          m.size = seen.size || (isSide ? m.name.offsetWidth : m.name.offsetHeight);
        });
        spread(track);
      }
    };
    // While a finger or the mouse holds the thumb, the rail stays where it is: the page's bar slimming as it scrolls would otherwise move
    // the rail, and the thumb with it, under a pointer that hasn't moved. It's laid out again once let go.
    var isLayoutDue = false;
    function layout() { if (drag) { isLayoutDue = true; return; } layOutSoon(rail); }
    // Scrolling only moves the thumb: the rail's size and its marks change only with the page's size (layout, above), so a scroll
    // never reads the page's layout.
    function move(atPx) { if (drag) near(); if (isShown && !followsScroll) thumb.style.transform = (isSide ? "translateX(" : "translateY(") + (size.startIn + (size.track - size.thumb) * Math.min(1, (atPx === undefined ? at() : atPx) / size.max)).toFixed(1) + "px)"; }
    var sleep = 0, queued = false;
    // Woken only once a scroll: the class is set as it wakes, not on every scroll event, so the page's watchers hear of it once.
    function wake() { if (!bar.classList.contains("awake")) bar.classList.add("awake"); clearTimeout(sleep); sleep = setTimeout(function () { bar.classList.remove("awake"); }, 1100); }
    (isPage ? window : scroller).addEventListener("scroll", function () { wake(); if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; move(); }); }, { passive: true });
    window.zaismaWatch.resize(layout);
    // What it scrolls, never a drawing laid over it (a carving's cut line comes first in a switch's well, and keeps its size as the tabs
    // in it narrow): a rail measured on while its tabs overflowed for a moment would stay on, its thumb out past the page's edge.
    var content = isPage ? document.body : Array.prototype.filter.call(scroller.children, function (child) { return !child.matches("svg, .edge, .cut-line, .rail"); });
    // What it holds changing size, and the box itself: a phone turned changes the box's height while what's in it stays as wide.
    if (isPage) window.zaismaWatch.size(content, layout); else Array.prototype.concat.apply([scroller], Array.prototype.slice.call(content)).forEach(function (child) { window.zaismaWatch.size(child, layout); });
    if (above) window.zaismaWatch.size(above, layout);
    // A box's content can change without its children changing size (a pane's views taking turns, a step showing): measured again then.
    if (!isPage) window.zaismaWatch.page(function (changes) { if (changes.some(function (change) { return scroller.contains(change.target); })) layout(); });
    var drag = null;
    // On a long page a pixel of the thumb is dozens of the page's, so a finger held still, which always trembles a little, would shake the
    // page: by touch, the thumb follows only once the finger has truly moved, from where it was then.
    var TOUCH_SLOP_PX = 6;
    // By touch, iOS places a finger through the page's scroll as its own side last had it, a few frames behind a scroll set here: read as
    // given, a finger held still seems to have moved by what the page just scrolled, and at dozens of the page's pixels to one of the
    // thumb's the page would shake and run away. So the finger's place on the page is taken back out through whichever of the last
    // SCROLLS_KEPT scrolls set here puts it nearest where it last was: a finger moves a few pixels a frame, the page dozens.
    var SCROLLS_KEPT = 8;
    function spotOf(event) {
      var spotPx = along(event);
      if (!drag.isTouch || !isPage) return spotPx;
      var onPagePx = spotPx + window.scrollY, best = spotPx, gap = Infinity;
      drag.scrolls.forEach(function (scroll) { var spot = onPagePx - scroll, away = Math.abs(spot - drag.last); if (away < gap) { gap = away; best = spot; } });
      return best;
    }
    function start(event, jump) {
      event.preventDefault();
      var before = at();
      if (jump) { var y = along(event) - (isSide ? groove.getBoundingClientRect().left : groove.getBoundingClientRect().top) - size.thumb / 2; to(Math.max(0, Math.min(1, y / (size.track - size.thumb))) * size.max); }
      drag = { y: along(event), last: along(event), from: at(), scrolls: [before, at()], isMoving: event.pointerType === "mouse", isTouch: event.pointerType !== "mouse" }; bar.classList.add("dragging");
      // A box that snaps (a track's covers) follows the thumb freely while it's dragged, never jumping cover to cover, and snaps once let go.
      if (!isPage && getComputedStyle(scroller).scrollSnapType !== "none") scroller.classList.add("is-dragged");
      try { bar.setPointerCapture(event.pointerId); } catch (error) {}
    }
    thumb.addEventListener("pointerdown", function (event) { start(event, false); });
    // A press anywhere else in its reach jumps there; a mark goes to its own part instead.
    // A mark's reach lies over the thumb where they meet: a press there takes the thumb, as a press anywhere on it does, never the mark.
    var pressedThumb = false, pressedMark = null, pressedAt = 0;
    bar.addEventListener("pointerdown", function (event) {
      if (thumb.contains(event.target)) return;
      if (event.target.closest(".rail-mark")) {
        var t = thumb.getBoundingClientRect();
        pressedThumb = along(event) >= (isSide ? t.left : t.top) && along(event) <= (isSide ? t.right : t.bottom);
        // A press that lets go where it started is a click on the mark after all: it goes to the mark's part (release, below).
        if (pressedThumb) { pressedMark = event.target.closest(".rail-mark"); pressedAt = along(event); start(event, false); }
        return;
      }
      start(event, true);
    });
    function follow(event) {
      if (!drag) return;
      var spotPx = spotOf(event);
      drag.last = spotPx;
      if (!drag.isMoving) { if (Math.abs(spotPx - drag.y) < TOUCH_SLOP_PX) return; drag.isMoving = true; drag.y = spotPx; drag.from = at(); }
      var goal = Math.max(0, Math.min(size.max, drag.from + (spotPx - drag.y) * size.max / Math.max(1, size.track - size.thumb)));
      if (Math.abs(goal - at()) < 1) return;
      to(goal);
      drag.scrolls.push(at()); if (drag.scrolls.length > SCROLLS_KEPT) drag.scrolls.shift();
    }
    bar.addEventListener("pointermove", follow);
    // The rail holds the pointer while it's dragged (setPointerCapture), but a browser can lose it or never give it (a press on the line
    // beside the thumb): so the page follows the pointer and hears it let go too, wherever it is, until the drag ends.
    window.addEventListener("pointermove", function (event) { if (drag && !bar.hasPointerCapture(event.pointerId)) follow(event); });
    window.addEventListener("pointerup", function (event) { if (drag && !bar.hasPointerCapture(event.pointerId)) release(event); });
    window.addEventListener("pointercancel", function () { if (drag) end(); });
    function end() { drag = null; bar.classList.remove("dragging"); settle(); if (isLayoutDue) { isLayoutDue = false; layout(); } }
    // Let go, a box that snaps glides to its nearest snapping point, then snaps again as it always does.
    function settle() {
      if (isPage || !scroller.classList.contains("is-dragged")) return;
      var box = scroller.getBoundingClientRect(), css = getComputedStyle(scroller), now = at();
      var padStart = parseFloat(isSide ? css.scrollPaddingLeft : css.scrollPaddingTop) || 0, edge = isSide ? box.left + scroller.clientLeft : box.top + scroller.clientTop;
      var spots = Array.prototype.filter.call(scroller.children, function (child) { return getComputedStyle(child).scrollSnapAlign.indexOf("start") >= 0; })
        .map(function (child) { var r = child.getBoundingClientRect(); return Math.max(0, Math.min(size.max, now + (isSide ? r.left : r.top) - edge - padStart)); });
      // Its two ends are places to stop too: dragged all the way, it stays flush at its start or its end.
      spots.push(0, size.max);
      var nearest = spots.length ? spots.reduce(function (best, spot) { return Math.abs(spot - now) < Math.abs(best - now) ? spot : best; }) : now;
      // It glides there in the time something takes to arrive (--motion-arrive), easing out, unless a new drag takes it up first; with
      // reduced motion it's there at once. Then it snaps again as it always does.
      var done = function () { if (!drag) scroller.classList.remove("is-dragged"); };
      var arriveMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--motion-arrive")) * 1000 || 300;
      if (Math.abs(nearest - now) < 1 || matchMedia("(prefers-reduced-motion: reduce)").matches) { to(nearest); return done(); }
      var startedAt = performance.now();
      (function step(time) {
        if (drag) return;
        var progress = Math.min(1, (time - startedAt) / arriveMs);
        to(now + (nearest - now) * (1 - Math.pow(1 - progress, 3)));
        if (progress < 1) requestAnimationFrame(step); else done();
      })(startedAt);
    }
    // One name shows at a time: the mark's nearest the pointer, sitting by its mark; while dragging, the part the thumb is in (the last mark
    // its middle has passed, or the first), riding beside the thumb's middle.
    // While the thumb is dragged, one name rides beside its middle: the part it's in, the last whose start has come into the first third of
    // the view (read only while dragging). Pointing, a mark's name opens only while the pointer is on the mark itself (its :hover), where a
    // click goes there.
    function near() {
      if (!marks.length || !drag) return;
      var middle = size.start + (size.track - size.thumb) * Math.min(1, at() / size.max) + size.thumb / 2, best = null;
      var view = isPage ? { start: 0, size: window.innerHeight } : (function (r) { return { start: isSide ? r.left : r.top, size: isSide ? r.width : r.height }; })(scroller.getBoundingClientRect());
      marks.forEach(function (m) { if (m.mark.hidden) return; var r = m.part.getBoundingClientRect(); if (!best || (isSide ? r.left : r.top) - view.start <= view.size / 3) best = m; });
      // Only its words change, never its rim (the edge rule's line beside them).
      if (best && riding.lastChild.textContent !== best.name.textContent) riding.lastChild.textContent = best.name.textContent;
      riding.style.setProperty("--riding-at", middle.toFixed(1) + "px");
    }
    bar.addEventListener("pointermove", near);
    bar.addEventListener("pointerdown", near);
    // By touch, letting go of the thumb near a mark goes to its part, as a click on the mark does with a mouse.
    var SNAP_PX = 18;
    function release(event) {
      // A finger only resting on the thumb goes nowhere.
      var wasDragging = Boolean(drag && drag.isMoving), tapped = pressedMark && Math.abs(along(event) - pressedAt) < 4 ? pressedMark : null; pressedMark = null; end();
      if (tapped) { tapped.goToPart(); return; }
      if (!wasDragging || event.pointerType === "mouse" || !marks.length) return;
      var middle = size.start + (size.track - size.thumb) * Math.min(1, at() / size.max) + size.thumb / 2, nearest = null, gap = SNAP_PX;
      marks.forEach(function (m) { if (m.mark.hidden) return; var away = Math.abs(parseFloat(m.mark.style[isSide ? "left" : "top"]) - middle); if (away <= gap) { gap = away; nearest = m; } });
      if (nearest) nearest.mark.click();
    }
    bar.addEventListener("pointerup", release); bar.addEventListener("pointercancel", end);
    layout(); wake();
  });
  }
  addRails(window.zaismaWatch.scrollBoxes(), document);
  wireRails();
  // A list the page swaps in later (the rooms on a game's page) gets its rail the same way, never the browser's own scrollbar.
  window.zaismaWatch.page(function (changes) {
    // The page's own rail arrives this way too: this script runs first in the body, before the rail is read.
    var scrollBoxes = [], hasSideBox = false, hasRail = false;
    changes.forEach(function (change) {
      Array.prototype.forEach.call(change.addedNodes || [], function (node) {
        if (node.nodeType !== 1 || !node.isConnected) return;
        if (node.matches("[data-rail]") && !wiredBars.has(node)) hasRail = true;
        if (node.closest(".rail, svg, .edge, .cut-line")) return;
        window.zaismaWatch.scrollBoxesIn(node).forEach(function (box) { if (scrollBoxes.indexOf(box) < 0) scrollBoxes.push(box); });
        if (node.matches("[data-side-rail]") || node.querySelector("[data-side-rail]")) hasSideBox = true;
      });
    });
    if (!scrollBoxes.length && !hasSideBox && !hasRail) return;
    addRails(scrollBoxes, document);
    wireRails();
  });
})();
`;


/**
 * Scroll fades: every box that scrolls up and down, wherever it is and whatever is in it, fades its words out over its
 * top and bottom edges while there's more to scroll that way, so nothing runs hard into the edge of its pane. Found by
 * itself, like the rail, on every device; a stand-in page under a header example (data-scroll-box), a box with a fade of its own
 * (data-own-fade, a birthday wheel) and form fields are left alone.
 */
export const SCROLL_FADE_SCRIPT = `/* scroll fades */(function () {
  // A phone's screen has less to spare for a fade.
  var isSmallScreen = window.matchMedia("(max-width: 760px), (max-height: 500px)"), boxes = [], dueBoxes = null;
  function fadePx() { return isSmallScreen.matches ? 20 : 34; }
  window.zaismaScrollFadePx = fadePx;
  // Everything is read before anything is written, so a box syncing reads the page's layout once.
  function measure(box) {
    // A table's rows fade out under its head, which stays as they scroll: the fade starts where the head ends.
    var head = box.querySelector(":scope > table > thead");
    return { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight, clientHeight: box.clientHeight, headPx: head ? head.offsetHeight : null };
  }
  function put(box, read) {
    var isScrollable = read.scrollHeight > read.clientHeight + 1;
    // Its whole length while there's anything more that way, however little, so the last words never sit whole against the edge; it eases
    // away (the --fade transition) once there's nothing more.
    var top = read.scrollTop > 0.5 ? fadePx() : 0, bottom = read.scrollHeight - read.clientHeight - read.scrollTop > 0.5 ? fadePx() : 0;
    box.style.setProperty("--fade-top", Math.max(0, top) + "px"); box.style.setProperty("--fade-bottom", Math.max(0, bottom) + "px");
    if (read.headPx !== null) box.style.setProperty("--fade-from", read.headPx + "px");
    // Masked only while there's something to fade: a mask on a box that doesn't scroll would only cost its repaints.
    box.classList.toggle("is-fading", isScrollable);
    box.classList.toggle("is-scrollable", isScrollable);
  }
  // Boxes syncing together are all read before any is written: one at a time, each write would make the next read lay the page out again.
  function syncAll(list) {
    var reads = list.map(measure);
    list.forEach(function (box, i) { put(box, reads[i]); });
  }
  // The batch the boxes' size callbacks share (zaismaWatch.size): each callback only marks its box, and the batch syncs them together.
  function inOnePass(work) {
    dueBoxes = new Set(); work();
    var due = Array.from(dueBoxes); dueBoxes = null; syncAll(due);
  }
  function sync(box) { if (dueBoxes) dueBoxes.add(box); else syncAll([box]); }
  // A box keeps a swipe or a wheel to itself only while it can scroll; one that can't lets it carry on to the page.
  function held(box) { box.classList.toggle("is-scrollable", box.scrollHeight > box.clientHeight + 1); }
  var holding = new WeakSet();
  function hold(box) {
    if (holding.has(box)) return;
    holding.add(box); held(box);
    window.zaismaWatch.size(box.firstElementChild || box, function () { held(box); });
    box.addEventListener("input", function () { held(box); });
  }
  function find() {
    // Boxes that scroll with no fade of their own (a header example's stand-in page, a table) still hold a swipe only while they can scroll.
    window.zaismaWatch.each("[data-scroll-box]", hold);
    fadeBoxes(window.zaismaWatch.scrollBoxes());
  }
  function fadeBoxes(scrollBoxes) {
    var found = scrollBoxes.filter(function (box) {
      if (box.classList.contains("scroll-fades")) return false;
      // A box with no fade from here still holds a swipe while it can scroll, as every box does (tokens.ts).
      if (/^(TEXTAREA|SELECT|INPUT)$/.test(box.tagName) || box.hasAttribute("data-scroll-box") || box.hasAttribute("data-own-fade")) { hold(box); return false; }
      return true;
    });
    boxes = boxes.filter(function (box) { return box.isConnected; });
    found.forEach(function (box) {
      box.classList.add("scroll-fades"); boxes.push(box);
      var queued = false;
      box.addEventListener("scroll", function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; sync(box); }); }, { passive: true });
      window.zaismaWatch.size(box, function () { sync(box); }, inOnePass);
    });
    syncAll(found);
  }
  find();
  // A box added later (a list the page swaps in) fades its words the same way.
  window.zaismaWatch.page(function (changes) {
    var added = [];
    changes.forEach(function (change) {
      Array.prototype.forEach.call(change.addedNodes || [], function (node) {
        if (node.nodeType !== 1 || !node.isConnected || node.closest(".rail, svg, .edge, .cut-line")) return;
        window.zaismaWatch.scrollBoxesIn(node).forEach(function (box) { if (added.indexOf(box) < 0) added.push(box); });
      });
    });
    if (added.length) fadeBoxes(added);
  });
  window.zaismaWatch.resize(function () { syncAll(boxes); });
  // Rows that scroll sideways fade over a side with more past it, and start where the one you're on shows whole.
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.zaismaWatch.each("[data-fades-sideways]", function (row) {
    // What's shown in it: a tab, a cover. A folded tab, or a switch's slab, ghost and ring, never counts, so a row whose box only rounds a
    // few pixels wider than what it shows (a phone's emulator) never fades.
    function shown() {
      return Array.prototype.filter.call(row.querySelectorAll(":scope > *, :scope > * > *"), function (el) {
        if (el.classList.contains("folded") || el.hasAttribute("aria-hidden") || el.children.length && el.parentElement === row && el.querySelector(":scope > a, :scope > button, :scope > .cover")) return false;
        return el.getBoundingClientRect().width >= 1 && !/^(absolute|fixed)$/.test(getComputedStyle(el).position);
      });
    }
    // More that way is something shown running past that edge.
    // Or words running on past it inside one block (a line of text that doesn't wrap): the row's own scroll says so.
    // Where what's shown starts and ends along the row's whole scrolled content is measured when the row or what's in it changes size;
    // a scroll moves none of it, so scrolling only reads how far the row is scrolled.
    var reach = null;
    function measure() {
      var box = row.getBoundingClientRect(), left = Infinity, right = -Infinity, scrollLeft = row.scrollLeft;
      shown().forEach(function (el) { var r = el.getBoundingClientRect(); left = Math.min(left, r.left); right = Math.max(right, r.right); });
      reach = { start: left === Infinity ? null : left - box.left + scrollLeft, end: right - box.left + scrollLeft, width: row.clientWidth, whole: row.scrollWidth };
    }
    function shownSpan() {
      if (!reach) measure();
      var scrollLeft = row.scrollLeft, scrolledBefore = scrollLeft, scrolledAfter = reach.whole - reach.width - scrollLeft;
      return reach.start === null ? { before: scrolledBefore, after: scrolledAfter } : { before: Math.max(scrollLeft - reach.start, scrolledBefore), after: Math.max(reach.end - scrollLeft - reach.width, scrolledAfter) };
    }
    function fades() { var span = shownSpan(); row.classList.toggle("more-left", span.before > 2); row.classList.toggle("more-right", span.after > 2); return span; }
    // It starts where the one you're on shows whole, once it's laid out (a gallery section off screen isn't yet), and again once the fonts are in.
    var here = row.querySelector('[aria-current="page"], [aria-pressed="true"]'), isStarted = false;
    function start() { if (here && !isStarted && row.scrollWidth - row.clientWidth > 1) { isStarted = true; row.showWhole(here, false); } }
    function ends() { reach = null; start(); fades(); }
    // Where something sits along the row's whole scrolled content.
    function along(el) { var r = el.getBoundingClientRect(), start = r.left - row.getBoundingClientRect().left + row.scrollLeft; return { start: start, end: start + r.width }; }
    // Scrolls the least that shows something whole, clear of the fades: back to just past the fade at the start (the row's scroll padding
    // there, which a framed switch sets to its fade at that side and snaps by), or on to the first stop, a shown thing's start, from which
    // it's whole clear of the fade at the end (--fade-sideways-px). The first or last thing shown goes flush to its end, no fade left. isGliding scrolls smoothly; a smooth scroll can be cut short (a touch
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
      var things = shown(), isLast = el === things[things.length - 1];
      if (el === things[0]) goal = 0; else if (isLast) goal = most;
      goal = Math.max(0, Math.min(most, goal));
      if (Math.abs(goal - now) < 1) return;
      if (!isGliding || reduce) { row.scrollLeft = goal; return; }
      row.scrollTo({ left: goal, behavior: "smooth" });
      clearTimeout(row.settleTimer); row.settleTimer = setTimeout(function () { if (isLast) goal = row.scrollWidth - row.clientWidth; if (Math.abs(row.scrollLeft - goal) > 1) row.scrollTo({ left: goal, behavior: "smooth" }); }, 450);
    };
    if (here) window.zaismaWatch.fontsIn(function () { if (isStarted) row.showWhole(here, false); });
    var isFadeQueued = false;
    row.addEventListener("scroll", function () { if (isFadeQueued) return; isFadeQueued = true; requestAnimationFrame(function () { isFadeQueued = false; fades(); }); }, { passive: true });
    window.zaismaWatch.size(row, ends); if (row.firstElementChild) window.zaismaWatch.size(row.firstElementChild, ends);
    // Words that narrow once their font arrives can leave a row that ran past its box fitting it again, its own size unchanged.
    window.zaismaWatch.fontArrived(ends);
    ends();
    // Its fades show at once where the page starts, and only ease in and out from the next frame on, so nothing grows in after the first paint.
    requestAnimationFrame(function () { requestAnimationFrame(function () { row.classList.add("fades-ease"); }); });
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
  window.zaismaWatch.each("[data-compacts]", function (bar) {
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

const standInPage = html`<div class="stand-in-page">${["Continue playing", "Popular", "New"].map((rowName, rowIndex) => html`<section><h3>${rowName}</h3><div class="stand-in-row">${Object.values(STAND_IN_COVERS).slice(rowIndex * 2, rowIndex * 2 + 4)}</div></section>`)}</div>`;
/** A header example: a small page of its own, cut like a pane, with the backdrop behind it and a stand-in page scrolling under the header (fixed things stay in the frame). */
const headerFrame = (markup: Raw, isTall = false, isPhoneWidth = false) => html`<div class="header-frame${isTall ? " tall" : ""}${isPhoneWidth ? " is-phone-width" : ""}"><div class="backdrop is-framed" aria-hidden="true"></div>${markup}<div class="header-scroll" data-scroll-box>${standInPage}</div></div>`;
/** A footer example: a small page of its own, cut like a pane, with the backdrop behind it, as the header's are. */
const pageFrame = (markup: Raw) => html`<div class="header-frame"><div class="backdrop is-framed" aria-hidden="true"></div><div class="header-scroll" data-scroll-box>${markup}</div></div>`;
/** A footer example: a frame as tall as the footer, at the width that shows it one way or another (it goes by its own width). */
const footerFrame = (width = "") => html`<div class="header-frame is-fitted${width ? ` ${width}` : ""}"><div class="backdrop is-framed" aria-hidden="true"></div>${footer()}</div>`;
const STAND_IN_ACCOUNT = { username: "emma_r" };
const LONG_NAMED_ACCOUNT = { username: "maximilian_vandenberg" };
const GAMES_SEARCH = { action: "#header", name: "search_text", searchText: "", placeholder: "Search games", label: "Search games", suggestionsUrl: "/design/examples/search-suggestions" };

component({
  name: "Header",
  slug: "header",
  group: "navigation",
  subgroup: "bars",
  summary: "The top of every page: Zaisma, where you are, search when the page has one, and you. It floats as glass and slims once the page scrolls.",
  styles: HEADER_STYLES,
  render: header,
  examples: [
    { label: "Try it: scroll the page under it, point at its tabs, open the menu", isWide: true, markup: headerFrame(header({ id: "example-top-try", current: "home", search: GAMES_SEARCH, account: STAND_IN_ACCOUNT, isOnDeveloperPage: false, yourGamesHref: "#header" }), true) },
    { label: "On a game's page: Back goes Home, or, reached from another Zaisma page, back to it as it was", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-back", current: "browse", search: GAMES_SEARCH, account: STAND_IN_ACCOUNT, isOnDeveloperPage: false, yourGamesHref: "#header", hasBackButton: true })) },
    { label: "Signed out", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-out", current: "home", search: GAMES_SEARCH, account: null, isOnDeveloperPage: false })) },
    { label: "Menu open, with a long username", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-long", current: "home", search: GAMES_SEARCH, account: LONG_NAMED_ACCOUNT, isOnDeveloperPage: false, isMenuOpen: true, yourGamesHref: "#header" }), true) },
    { label: "Search open, its finishes and games under it (on a phone it takes the tabs' place)", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-search", current: "home", search: { ...GAMES_SEARCH, searchText: "ash", state: "is-open", shownSuggestions: SEARCH_STAND_IN.suggestionsFor("ash") }, account: STAND_IN_ACCOUNT, isOnDeveloperPage: false, yourGamesHref: "#header", isSearchOpen: true }), true) },
    { label: "On the dashboard: game search on a computer, and on a phone its extra tabs take that room", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-dev", current: "developer", search: GAMES_SEARCH, isSearchOnComputerOnly: true, account: STAND_IN_ACCOUNT, isOnDeveloperPage: true, yourGamesHref: "#header" })) },
    { label: "A guest on a game's page: on a phone, Sign in is its icon alone", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-guest", current: null, search: GAMES_SEARCH, account: null, isOnDeveloperPage: false, hasPageRunner: true, hasBackButton: true })) },
    { label: "Compact after scrolling, on a page with its own runner (a game's Play): Sign in is a secondary button", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-runner", current: "home", search: GAMES_SEARCH, account: null, isOnDeveloperPage: false, hasPageRunner: true, isCompact: true })) },
    { label: "The forum on a 320 px phone: with every other step taken, the tabs scroll", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-forum-phone", current: "forum", search: GAMES_SEARCH, account: null, isOnDeveloperPage: true }), false, true) },
    { label: "On sign-in: Zaisma alone", isWide: true, isStill: true, markup: headerFrame(header({ id: "example-top-sign-in", current: null, isOnDeveloperPage: false, isOnSignInPage: true })) },
  ],
});

component({
  name: "Account button",
  slug: "account-button",
  group: "actions",
  subgroup: "buttons",
  summary: "You, at the header's end once you're signed in: your picture alone is the button, a slab as tall as the controls beside it. It opens the account menu, which names you.",
  styles: `
/* Your picture as a slab (materials.ts, holds-art): raised on the header's glass, as tall as the controls beside it and cut by the edge rule
   like them, so it fits the header's corner. Its states are the slab's: pointed it catches the light, pressed it sinks in place, and by keyboard
   the focus line runs round its whole cut. Open, it looks as at rest, as any button that opens a menu does: the menu says so. */
.me { --control-height: var(--control-height-regular); }
.me:focus-visible { outline: none; }
`,
  render: accountButton,
  examples: [
    { label: "Try it: point at it, press it, Tab to it, open its menu", markup: html`${accountButton({ ...STAND_IN_ACCOUNT, menuId: "example-me-try-menu" })}${accountMenu(STAND_IN_ACCOUNT.username, "example-me-try-menu")}` },
    { label: "Rest", markup: accountButton({ ...STAND_IN_ACCOUNT, menuId: "example-me-menu" }), isStill: true },
    { label: "Pointed", markup: accountButton({ ...STAND_IN_ACCOUNT, menuId: "example-me-menu", state: "is-pointed" }), isStill: true },
    { label: "Pressed", markup: accountButton({ ...STAND_IN_ACCOUNT, menuId: "example-me-menu", state: "is-pressed" }), isStill: true },
    { label: "Keyboard focus", markup: accountButton({ ...STAND_IN_ACCOUNT, menuId: "example-me-menu", state: "is-focused" }), isStill: true },
  ],
});

component({
  name: "Footer",
  slug: "footer",
  group: "navigation",
  subgroup: "bars",
  summary: "The end of every page: for game developers, the forum, the source and the rules. One slim row, or two columns on a phone.",
  styles: `
/* The foot, at the end of the page. */
/* The footer: a slab of the header's glass across the bottom of the page, where the page ends, never floating over it. Its words are all of
   it, so they keep a pane's margin from its edge. */
.foot {
  position: relative; width: min(var(--size-page-wide), calc(100% - 2 * var(--pad-pane))); margin: var(--gap-block-block) auto var(--pad-pane);
  color: var(--muted); font: var(--type-note); --glass-tint: var(--glass-top);
  transition: var(--glass-transition);
}
.foot > :not(.edge) { position: relative; z-index: 3; }
/* One slim row, as tall as the header (a bar of glass, materials.ts, its words the words margin all round): Zaisma's mark, its own places, and the rules at the end, quieter. Short of room the rules take a line of
   their own, and where those lines would wrap (a phone, by the footer's own width) they're two columns and the mark goes. */
.foot { container: foot / inline-size; }
.foot-in { display: flex; align-items: center; gap: var(--gap-block-block); }
.foot-links { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--gap-words-words) var(--gap-block-block); white-space: nowrap; }
.foot-group { display: flex; flex-wrap: wrap; gap: var(--gap-words-words) var(--gap-block-block); }
.foot-group.is-own { color: var(--ink-2); }
@container foot (max-width: 34rem) {
  .foot-in > .logo { display: none; }
  .foot-links { display: grid; grid-auto-flow: row dense; grid-template-columns: max-content 1fr; gap: var(--gap-words-control) var(--gap-block-block); }
  .foot-group { display: contents; }
  .foot-group > .link { grid-column: 1; justify-self: start; }
  /* Content rules ends the first column, and the rest of the rules are the second. */
  .foot-group:not(.is-own) > :not(:first-child) { grid-column: 2; }
}
`,
  render: footer,
  examples: [
    { label: "On a wide screen: one row, as tall as the header, the rules at its end", isWide: true, markup: footerFrame() },
    { label: "Short of room: the rules take a second line", isWide: true, markup: footerFrame("is-tablet-width") },
    { label: "On a phone: two columns, with no mark", isWide: true, markup: footerFrame("is-phone-width") },
  ],
});

component({
  name: "Rail",
  slug: "rail",
  group: "panes",
  subgroup: "materials",
  after: "light",
  summary: "Zaisma's own scrollbar, on every device: a channel carved in the glass with a slab sliding in it, at the frame gap from the glass's edges, its ends slanted so the thumb slides flush into them, or square where they meet a square corner. It rests faintly, wakes while things move, and drags with a finger or the mouse.",
  styles: `
/* Zaisma's own scrollbar, on every device: a channel carved in the glass with a slab sliding in it (the materials, materials.ts), resting
   faintly and waking while it moves. Down a box it runs the box's height at the right, at the frame gap from the edges of the glass round
   it (RAIL_SCRIPT places it); for the page, down the page's right gutter, carving its own slanted ends; sideways, under the box. In a box
   its channel is cut by the edge rule, with a carving's rim, so an end at a cut corner lies the frame gap from the corner's cut all along it,
   as its side lies from the side, and an end at a square corner is square; the thumb's ends nest in the channel's. */
.own-scroll { scrollbar-width: none; }
.own-scroll::-webkit-scrollbar { display: none; }
.rail { display: none; position: absolute; z-index: 6; top: 0; left: 0; width: var(--rail-reach); opacity: 0.6; transition: opacity var(--motion-arrive); }
.rail.is-on { display: block; }
.glass > .rail { position: absolute; z-index: 6; }
/* The page's sits in the middle of the page's right gutter, as clear of the screen's edge as of the glass. */
.rail[data-rail="page"] { position: fixed; z-index: 12; left: auto; right: calc((var(--pad-pane) - var(--rail-reach)) / 2); top: 90px; bottom: 14px; }
.rail.awake, .rail:hover, .rail.dragging { opacity: 1; }
/* What a rail's thumb is dragging follows it freely: it snaps once let go (settle in RAIL_SCRIPT). */
.own-scroll.is-dragged { scroll-snap-type: none; }
/* Its channel runs its whole length down the middle of its reach, both its ends slanted, longest on the side toward what scrolls; the thumb's
   ends slant the same way, so at either end it slides flush into the channel's end, as a switch's slab into its well. */
.rail > .rail-line { position: absolute; top: 0; bottom: 0; left: calc((var(--rail-reach) - var(--rail-width)) / 2); width: var(--rail-width); cursor: pointer; --rail-start-cut: var(--cut-size-top-right); --rail-end-cut: var(--cut-size-bottom-right); }
.rail[data-rail="page"] > .rail-line { --rail-start-cut: var(--rail-width); --rail-end-cut: var(--rail-width); --cut-shape: polygon(0 0, 100% var(--rail-start-cut), 100% calc(100% - var(--rail-end-cut)), 0 100%); }
/* The thumb's ends nest in the channel's at the groove's 2px, by the edge rule, so it slides flush into either. */
.rail-thumb { --thumb-slant: calc(var(--rail-width) - 4px); --thumb-start-cut: clamp(0px, calc(var(--rail-start-cut) - 1.17px), var(--thumb-slant)); --thumb-end-cut: clamp(0px, calc(var(--rail-end-cut) - 1.17px), var(--thumb-slant));
  clip-path: polygon(0 0, calc(100% - var(--thumb-start-cut)) 0, 100% var(--thumb-start-cut), 100% calc(100% - var(--thumb-end-cut)), calc(100% - var(--thumb-end-cut)) 100%, 0 100%); }
.rail-thumb { cursor: grab; }
.rail.dragging .rail-thumb { cursor: grabbing; }
/* Sideways (a table, a chart): the same rail laid on its side, under the box, its channel along the foot of its reach, so at a pane's foot it
   sits at the frame gap like anything with an edge. */
/* The header has no room for a rail: its tabs only fade where they run on. */
.top .rail.sideways.is-on { display: none; }
.rail.sideways { position: relative; top: auto; left: auto; width: auto; height: var(--rail-reach); user-select: none; -webkit-user-select: none; }
.rail.sideways > .rail-line { top: auto; bottom: 0; left: 0; right: 0; width: auto; height: var(--rail-width); --rail-start-cut: var(--cut-size-bottom-left); --rail-end-cut: var(--cut-size-bottom-right); }
.rail.sideways .rail-thumb { clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--thumb-end-cut)), calc(100% - var(--thumb-end-cut)) 100%, var(--thumb-start-cut) 100%, 0 calc(100% - var(--thumb-start-cut))); }
/* A mark per part of the page: a hairline etched across the groove (materials.ts) that turns orange when pointed at. Pointing at the rail
   opens the nearest mark's name on a small glass label to its left; dragging, the name of the part the thumb is in rides beside it. */
/* Its click area is far bigger than the etch: 24px tall and reaching in over the page, so a mark is easy to hit. */
.rail-mark { position: absolute; left: -12px; width: 28px; height: 24px; margin-top: -12px; padding: 0; border: 0; cursor: pointer; background: none; }
.rail-mark::before { content: ""; position: absolute; left: 17px; right: 5px; top: 11.5px; height: 1px; }
.rail-mark[hidden] { display: none; }
/* While the thumb is dragged, the marks don't answer the pointer: only the part the thumb is in is named and lit. */
.rail.dragging .rail-mark { pointer-events: none; }
/* A name sits on a small slab (materials.ts) against the channel. Pointing at a mark (where a click goes to its part), its name slides out
   from under the channel by it; dragging, one name rides beside the thumb (.rail-riding), only its words changing as it passes a part, so
   nothing slides in and out mid-drag. */
.rail-mark > span, .rail-riding { position: absolute; right: 15px; pointer-events: none; opacity: 0; visibility: hidden; translate: 6px 0;
  transition: opacity var(--motion-state) ease-out, translate var(--motion-state) ease-out, visibility 0s var(--motion-state); }
.rail-mark > span { top: 50%; transform: translate(0, calc(-50% + var(--label-shift, 0px))); }
.rail-riding { top: var(--riding-at, 0px); transform: translateY(-50%); white-space: nowrap; }
.rail:not(.dragging) .rail-mark:hover > span, .rail.dragging .rail-riding { opacity: 1; visibility: visible; translate: 0 0; transition: opacity var(--motion-state) ease-out, translate var(--motion-state) ease-out, visibility 0s; }
/* Along a sideways rail, a mark is a short upright tick across the channel, and its name slides up out of it, above it. */
.rail.sideways .rail-mark { left: auto; top: -10px; width: 24px; height: 26px; margin: 0 0 0 -12px; }
.rail.sideways .rail-mark::before { left: 11.5px; right: auto; top: 18px; bottom: 2px; width: 1px; height: auto; }
.rail.sideways .rail-mark > span, .rail.sideways .rail-riding { right: auto; translate: 0 6px; }
.rail.sideways .rail-mark > span { top: auto; left: 50%; bottom: 17px; transform: translateX(calc(-50% + var(--label-shift, 0px))); }
.rail.sideways .rail-riding { top: auto; bottom: 17px; left: var(--riding-at, 0px); transform: translateX(-50%); }
.rail.sideways:not(.dragging) .rail-mark:hover > span, .rail.sideways.dragging .rail-riding { translate: 0 0; }
/* The page's thumb, where the browser can, is moved by the page's scroll itself (RAIL_SCRIPT's followsScroll): its length a share of the
   groove (--thumb-share, the view over the page), its place from the groove's top slant to its foot's, all in the groove's own size, so a
   browser bar showing or hiding moves it in the same frame. */
@supports (animation-timeline: scroll()) {
  .rail.follows-scroll .rail-thumb { --slant-in: 2.83px; --thumb-length: max(36px, calc(var(--thumb-share, 0.2) * (100% - 2 * var(--slant-in))));
    height: var(--thumb-length); transform: none; animation: rail-follows-page linear both; animation-timeline: scroll(root block); }
  @keyframes rail-follows-page { from { top: var(--slant-in); } to { top: calc(100% - var(--thumb-length) - var(--slant-in)); } }
}
/* In the narrow layout (a phone, or a small window), the page's rail starts below the header. */
@media (max-width: 760px) {
  .rail[data-rail="page"] { top: calc(var(--pad-pane) + env(safe-area-inset-top, 0px) + var(--header-height) + 10px); bottom: 10px; }
}
/* Beside the header's rail on a phone on its side, it runs the screen's whole height, clear of the notch. */
@media ${HEADER_RAIL_MEDIA} {
  html:not(.is-playing):has(> body > .top.has-tab-row) .rail[data-rail="page"] { top: max(var(--pad-frame), var(--corner-room)); bottom: max(var(--pad-frame), var(--corner-room)); right: calc(var(--safe-right) + (var(--pad-pane) - var(--rail-reach)) / 2); }
}
/* By touch, a finger on it drags the thumb instead of the page. A finger held on it never selects the words beside it, opens the phone's
   callout or flashes a tap's highlight. */
@media (hover: none), (pointer: coarse) {
  .rail { touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
}
/* By touch, a mark is only a faint tick: a tap or a drag lands on the rail itself (letting go near a tick goes to its part), and the marks'
   names and full ticks show only while a finger drags the thumb, wiping open and shut with the drag, never on a tap's leftover hover. */
@media (hover: none) {
  .rail .rail-mark { pointer-events: none; }
  .rail .rail-mark > span { display: none; }
}
`,
  render: rail,
  examples: [
    {
      label: "Down a box",
      markup: html`<div class="rail-box">${glassPane({ paneWidth: "fit", body: stackOfOne(html`<p>${"Wander a forest that grows around you. No combat and no timers: climbing, finding and listening. ".repeat(14)}</p>`, "words") })}</div>`,
    },
    {
      label: "Sideways, under a box (a table, a chart)",
      markup: glassPane({ paneWidth: "fit", body: stackOfOne(html`<div class="rail-side-box" data-fades-sideways data-side-rail><p>${"Patch notes, 1.4: the second boss telegraphs earlier, the arena's pillars break sooner, and saves sync across devices."}</p></div>`) }),
    },
    {
      label: "Down a box, its parts marked: point at the rail for their names (by touch, drag its thumb; let go near a mark to go there)",
      markup: html`<div class="rail-box">${glassPane({ paneWidth: "fit", body: stack({ items: ["1.4", "1.3", "1.2", "1.1"].flatMap((version) => [
        { kind: "words" as const, markup: html`<h3 class="rail-example-part" data-rail-mark="${version}">Version ${version}</h3>` },
        { kind: "words" as const, markup: html`<p>${"Rebalanced the second boss, sped up loading, and fixed saves that wouldn't sync. ".repeat(3)}</p>` },
      ]) }) })}</div>`,
    },
    {
      label: "Sideways, its parts marked",
      markup: glassPane({ paneWidth: "fit", body: stackOfOne(html`<div class="rail-side-box" data-fades-sideways data-side-rail><p>${["Monday", "Tuesday", "Wednesday", "Thursday"].map(
        (day) => html`<span data-rail-mark="${day}">${day}: 1,204 players, 3,906 hours. </span>`,
      )}</p></div>`) }),
    },
  ],
});

/** Every stand-in game's cover, as a track's items. */
const STAND_IN_COVER_ITEMS: LayoutItem[] = Object.values(STAND_IN_COVERS).map((cover) => ({ kind: "block", markup: cover }));
export interface ShelfOptions {
  /** Unique on the page: the shelf itself, for a page script (the home's Continue playing). */
  id: string;
  /** Its track's id, for a page script that fills it. */
  trackId: string;
  title: string;
  /** Where its title goes, the whole list it's from (Browse, sorted the same way): the title is then a Link. Left out, it's words alone. */
  titleHref?: string;
  /** A small switch between ways to sort it (Recently played, Recently updated), after the title. */
  sortTabs?: SwitchTab[];
  /** Its covers. A page script may fill them in instead. */
  items: LayoutItem[];
  /** What it says while it has no covers (Continue playing before you've played anything), in place of its row. */
  emptyText?: string;
  /**
   * Its covers in lines down the page (a Grid) rather than a track that scrolls sideways: a shelf that's a part of a library (Your
   * games). leadCell makes its first cover the one it's grounded on, twice the rest (Grid's hasLeadCell).
   */
  coversAs?: "track" | "grid" | "grid_with_lead_cell";
  /** A link at the heading's end, to the whole of what the shelf shows part of (Recently played's All you've played). */
  endLink?: { words: string; href: string };
}

/**
 * A shelf: a row of games under its heading, with its sort at the heading's end, and its covers in a track that scrolls sideways on its
 * rail. Where the heading and the sort don't fit side by side (a phone), the sort goes under the heading and fills that line.
 */
export function shelf(options: ShelfOptions): Raw {
  const titleId = `${options.id}-title`;
  const title = html`<h2 class="shelf-title" id="${titleId}">${options.titleHref ? textLink(options.title, options.titleHref) : options.title}</h2>`;
  const isEmpty = options.items.length === 0 && options.emptyText !== undefined;
  return html`<section class="shelf" id="${options.id}" aria-labelledby="${titleId}">${stack({
    items: [
      options.sortTabs
        ? {
            kind: "block",
            markup: row({
              widths: "lead-fills",
              // Where the sort doesn't fit beside the heading it goes under it, filling the line.
              items: [{ kind: "words", markup: title }, { kind: "block", markup: row({ widths: "lead-fills", items: [{ kind: "control", markup: tabSwitch({ label: "Sort", switchSize: "small", tabs: options.sortTabs }) }] }) }],
            }),
          }
        : options.endLink
          ? { kind: "block", markup: row({ widths: "lead-fills", items: [{ kind: "words", markup: title }, { kind: "words", markup: textLink(options.endLink.words, options.endLink.href) }] }) }
          : { kind: "words", markup: title },
      isEmpty
        ? { kind: "block", markup: stateNote({ stateKind: "empty", text: options.emptyText! }) }
        : options.coversAs === "grid" || options.coversAs === "grid_with_lead_cell"
          ? { kind: "block", markup: grid({ whenEmpty: stateNote({ stateKind: "empty", text: options.emptyText ?? "" }), id: options.trackId, itemSize: "cover", hasLeadCell: options.coversAs === "grid_with_lead_cell", items: options.items.filter((layoutItem): layoutItem is GridItem => layoutItem.kind !== "control") }) }
          : { kind: "block", markup: track({ whenEmpty: stateNote({ stateKind: "empty", text: options.emptyText ?? "" }), id: options.trackId, itemSize: "cover", items: options.items }) },
    ],
  })}</section>`;
}

component({
  name: "Shelf",
  slug: "shelf",
  group: "navigation",
  subgroup: "scrolling",
  summary: "A row of games under its heading: the home's Popular, Trending and Continue playing. Its sort sits at the heading's end; its covers scroll sideways on its rail, a few showing with the next peeking in.",
  styles: `
/* A shelf: its heading, then its sort, in a row, then its track of covers. The heading keeps its whole width beside it, up to the
   shelf's own (a container), so the sort goes under it before it wraps; only a heading longer than the shelf wraps,
   keeping the pane's margin at its end too. */
.shelf { container-type: inline-size; --shelf-words-inset: var(--pad-words); }
.shelf .shelf-title { width: max-content; max-width: calc(100cqi - 2 * var(--shelf-words-inset)); margin: 0; font: var(--type-section); color: var(--ink); text-wrap: balance; }
/* Under the heading, the sort fills its line, never wider than it: the sort gives up room round its tabs' words to fit
   (Switch), so its cell may be narrower than its words at their roomiest (the heading's row has wrapped: is-wrapped, layout.ts). */
.shelf > .layout-stack > .stack-cell > .layout-row.is-wrapped > .row-cell.is-block { flex: 1 1 100%; min-width: 0; }
.shelf > .layout-stack > .stack-cell > .layout-row.is-wrapped > .row-cell.is-block > .layout-row { flex: 1 1 auto; }
.shelf > .layout-stack > .stack-cell > .layout-row.is-wrapped > .row-cell.is-block > .layout-row > .row-cell.fills { min-width: 0; }
/* With no games yet, a line in their place. */
`,
  render: shelf,
  examples: [
    { label: "In lines down the page, its first cover the lead (Your games' Favorites)", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(shelf({ id: "example-shelf-favorites", trackId: "example-shelf-favorites-grid", title: "Favorites", coversAs: "grid_with_lead_cell", items: STAND_IN_COVER_ITEMS })) }) },
    { label: "In lines, with a link to the whole at the heading's end (Recently played)", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(shelf({ id: "example-shelf-recent", trackId: "example-shelf-recent-grid", title: "Recently played", endLink: { words: "All you've played", href: "#shelf" }, coversAs: "grid", items: STAND_IN_COVER_ITEMS.slice(0, 5) })) }) },
    { label: "Popular, its title a link to the whole list", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(shelf({ id: "example-shelf-popular", trackId: "example-shelf-popular-track", title: "Popular", titleHref: "#shelf", items: STAND_IN_COVER_ITEMS })) }) },
    {
      label: "Continue playing, with its sort",
      isWide: true,
      markup: glassPane({
        paneWidth: "full",
        body: stackOfOne(shelf({
          id: "example-shelf-continue",
          trackId: "example-shelf-continue-track",
          title: "Continue playing",
          sortTabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }],
          items: STAND_IN_COVER_ITEMS.slice(0, 5),
        })),
      }),
    },
    {
      label: "A long title with its sort: on a phone the sort goes under it",
      isWide: true,
      markup: glassPane({
        paneWidth: "full",
        body: stackOfOne(shelf({
          id: "example-shelf-long",
          trackId: "example-shelf-long-track",
          title: "Because you played Ashen Crown",
          titleHref: "#shelf",
          sortTabs: [{ label: "Most players", tabValue: "players", isCurrent: true }, { label: "Newest", tabValue: "newest", isCurrent: false }],
          items: STAND_IN_COVER_ITEMS.slice(2),
        })),
      }),
    },
    {
      label: "Empty: Continue playing before you've played anything",
      isWide: true,
      markup: glassPane({
        paneWidth: "full",
        body: stackOfOne(shelf({ id: "example-shelf-empty", trackId: "example-shelf-empty-track", title: "Continue playing", items: [], emptyText: "Games you play show up here." })),
      }),
    },
  ],
});

/** A place in a sidebar: a link with its words, and an icon and a count when it has them. */
export interface SidebarPlace {
  label: string;
  href: string;
  isCurrent?: boolean;
  icon?: ListedIcon;
  /** A small number at its end, like unread reports: a Tag. */
  badgeCount?: number;
  /** Its own places (a gallery group's subgroups): it's a folder of them that opens in place, open to start with while it's current. */
  places?: SidebarPlace[];
}

export interface SidebarOptions {
  /** Unique on the page: its button names it (sidebarButton's controls), and its phone sheet is "{id}-sheet". */
  id: string;
  /** What the places are, for a screen reader and as its sheet's title on a phone: "Design", "Settings". */
  label: string;
  places: SidebarPlace[];
  /** Lowercase words joined by dashes: whether it was left folded is kept per browser under zaisma-sidebar:<rememberKey>. */
  rememberKey: string;
}

/** The places, as a stacked Switch: the place you're on is its slab, and a place with places of its own is a folder. */
const placeAsTab = (place: SidebarPlace): SwitchTab => ({ ...place, isCurrent: Boolean(place.isCurrent), places: place.places?.map(placeAsTab) });
const sidebarPlaces = (label: string, places: SidebarPlace[]): Raw => tabSwitch({ label, switchSize: "regular", isVertical: true, tabs: places.map(placeAsTab) });

/**
 * A page's own places down its side: a stacked Switch on a floating pane as tall as its places, scrolling on its rail past the screen's height,
 * beside the page (sidebarLayout), and its button, at the header's start, folds it away. Where the page can't have a column beside it, it's a
 * sheet of Docked glass from the start edge, on the layer stack like every sheet (LAYERS_SCRIPT), gone once a place is picked, on a press beside it or Esc.
 */
export function sidebar(options: SidebarOptions): Raw {
  const places = sidebarPlaces(options.label, options.places);
  return html`<nav class="sidebar glass glass-pane compact pinned" id="${options.id}" aria-label="${options.label}" data-sidebar-remember="${options.rememberKey}" data-glass data-glass-corners="pane">${EDGE}<div class="sidebar-in pane-in">${places}</div></nav>${sheetMarkup({ id: `${options.id}-sheet`, title: options.label, body: places, closeButton: tertiaryButton(action("close"), { type: "submit", formMethod: "dialog", isLabelHidden: true, isSmall: true }), placement: "start" })}`;
}

/** The button that folds a sidebar away and back on a wide screen, and slides it over the page on a phone: at the start of the page's header or bar. */
/** The one button a Sidebar has: a small Secondary button with the sidebar's icon, wired for SIDEBAR_SCRIPT to fold the sidebar it controls. */
export function sidebarButton(options: { controls: string; label: string; isExpanded: boolean }): ControlMarkup {
  // Beside the page it's on the sidebar's side, over it: the start of the page's header (siteHeader's sidebarButton) or bar.
  return secondaryButton(action("sidebar", options.label), { type: "button", isLabelHidden: true, isSmall: true, controls: options.controls, isExpanded: options.isExpanded, dataAttributes: { "sidebar-button": "" } });
}

/**
 * A sidebar beside the page: the sidebar in its own column, staying in view while the page scrolls, the page in the rest. Folded, the page
 * takes the whole width. On a reading page the page is a reading column and the pair sits in the middle of the wide frame. On a phone the
 * sidebar is its sheet, so the page has the width there too.
 */
export function sidebarLayout(options: { sidebar: Raw; main: Raw; isCollapsed?: boolean }): Raw {
  return html`<div class="sidebar-layout${options.isCollapsed ? " is-collapsed" : ""}"><div class="sidebar-layout-in">${options.sidebar}<div class="sidebar-main">${options.main}</div></div></div>`;
}

/** Where a sidebar is a sheet over the page instead of beside it: narrower than the sidebar and a column of this much beside it, at any size of text. */
const SIDEBAR_SHEET_BELOW = "45rem";

/**
 * The sidebar's button. On a wide screen it folds the sidebar away and back (an exit of opacity and transform only, then the column goes),
 * remembered per browser; at phone width it opens the sidebar's sheet, which a place picked, a press beside it or Esc closes, and the focus
 * goes back to the button.
 */
export const SIDEBAR_SCRIPT = `/* sidebars */(function () {
  // Whether it's a sheet now: Sidebar layout's container query says so where the page can't fit both, at any size of text.
  function isSheet(nav) { return getComputedStyle(nav).getPropertyValue("--sidebar-is-sheet").trim() === "1"; }
  var isReduced = function () { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; };
  function keyOf(nav) { return "zaisma-sidebar:" + nav.getAttribute("data-sidebar-remember"); }
  function buttonsOf(nav) { return document.querySelectorAll('[data-sidebar-button][aria-controls="' + nav.id + '"], [data-sidebar-button][aria-controls="' + nav.id + '-sheet"]'); }
  function say(nav) {
    var layout = nav.closest(".sidebar-layout"), sheet = document.getElementById(nav.id + "-sheet");
    buttonsOf(nav).forEach(function (button) {
      button.setAttribute("aria-controls", isSheet(nav) ? nav.id + "-sheet" : nav.id);
      button.setAttribute("aria-expanded", String(isSheet(nav) ? Boolean(sheet && sheet.open) : Boolean(layout && !layout.classList.contains("is-collapsed"))));
    });
  }
  function endFold(nav, layout) { layout.classList.remove("is-folding"); nav.classList.remove("is-leaving"); ["--sidebar-left", "--sidebar-top", "--sidebar-width", "--sidebar-height"].forEach(function (name) { nav.style.removeProperty(name); }); }
  // Folding moves only transforms and opacity: the sidebar leaves from where it was, held there out of the page's way, and the page, laid out
  // at its new width at once, slides from where it was into its new place (first, last, invert, play), so nothing snaps.
  function fold(nav, isFolded, isKept) {
    var layout = nav.closest(".sidebar-layout");
    if (!layout) return;
    if (isKept) try { localStorage.setItem(keyOf(nav), isFolded ? "hidden" : "shown"); } catch (error) {}
    // Pressed again while it's still going, the last fold ends here: left to run, it would keep the sidebar out of its column as it comes back, and the page would drop into that column.
    cancelAnimationFrame(nav.foldFrame); clearTimeout(nav.foldTimer); clearTimeout(nav.slideTimer);
    endFold(nav, layout);
    var main = layout.querySelector(".sidebar-main"), isMoving = isKept && !isReduced() && main;
    var first = isMoving ? main.getBoundingClientRect() : null, held = isMoving && isFolded ? nav.getBoundingClientRect() : null;
    if (held) {
      nav.style.setProperty("--sidebar-left", held.left + "px"); nav.style.setProperty("--sidebar-top", held.top + "px");
      nav.style.setProperty("--sidebar-width", held.width + "px"); nav.style.setProperty("--sidebar-height", held.height + "px");
      layout.classList.add("is-folding");
    }
    layout.classList.toggle("is-collapsed", isFolded);
    say(nav);
    if (held) {
      nav.foldFrame = requestAnimationFrame(function () { nav.classList.add("is-leaving"); });
      nav.foldTimer = setTimeout(function () { endFold(nav, layout); }, 350);
    }
    if (!isMoving) return;
    var shiftPx = first.left - main.getBoundingClientRect().left;
    if (Math.abs(shiftPx) < 1) return;
    main.style.transition = "none"; main.style.transform = "translateX(" + shiftPx + "px)";
    void main.offsetWidth;
    main.style.transition = "transform 0.45s cubic-bezier(.2,.8,.2,1)"; main.style.transform = "";
    nav.slideTimer = setTimeout(function () { main.style.removeProperty("transition"); main.style.removeProperty("transform"); }, 500);
  }
  window.zaismaWatch.each("nav.sidebar[data-sidebar-remember]", function (nav) {
    try { var kept = localStorage.getItem(keyOf(nav)); if (kept === "shown" || kept === "hidden") fold(nav, kept === "hidden", false); } catch (error) {}
    // Its sheet may come later in the page than the sidebar.
    window.zaismaWatch.whenRead(function () { listenToSheet(nav); });
    say(nav);
  });
  function listenToSheet(nav) {
    var sheet = document.getElementById(nav.id + "-sheet");
    if (sheet) {
      sheet.addEventListener("close", function () { say(nav); var button = buttonsOf(nav)[0]; if (button && (!document.activeElement || document.activeElement === document.body || sheet.contains(document.activeElement))) button.focus({ preventScroll: true }); });
      // A place picked closes it, whether it goes to another page or to a part of this one.
      sheet.addEventListener("click", function (event) { if (event.target.closest && event.target.closest("a[href]")) sheet.close(); });
    }
    say(nav);
  }
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-sidebar-button]");
    if (!button) return;
    var id = button.getAttribute("aria-controls").replace(/-sheet$/, ""), nav = document.getElementById(id), sheet = document.getElementById(id + "-sheet");
    if (!nav) return;
    if (isSheet(nav)) { if (sheet && !sheet.open) { sheet.showModal(); say(nav); } return; }
    fold(nav, !nav.closest(".sidebar-layout").classList.contains("is-collapsed"), true);
  });
  // Grown wide enough for both with the sheet open, the sidebar is beside the page again.
  var isQueued = false;
  window.addEventListener("resize", function () {
    if (isQueued) return;
    isQueued = true;
    requestAnimationFrame(function () {
      isQueued = false;
      document.querySelectorAll("nav.sidebar[data-sidebar-remember]").forEach(function (nav) { var sheet = document.getElementById(nav.id + "-sheet"); if (!isSheet(nav) && sheet && sheet.open) sheet.close(); say(nav); });
    });
  });
})();
`;

const GALLERY_GROUPS: SidebarPlace[] = [
  { label: "Foundations", href: "#sidebar" },
  { label: "Layout", href: "#sidebar" },
  { label: "Actions", href: "#sidebar" },
  {
    label: "Inputs",
    href: "#sidebar",
    isCurrent: true,
    places: [
      { label: "Fields", href: "#sidebar", isCurrent: true },
      { label: "Choices", href: "#sidebar" },
      { label: "Pickers", href: "#sidebar" },
    ],
  },
  { label: "Navigation", href: "#sidebar" },
  { label: "Panes", href: "#sidebar" },
  { label: "Data", href: "#sidebar" },
];
const SETTINGS_PLACES: SidebarPlace[] = [
  { ...action("hosting"), href: "#sidebar", isCurrent: true },
  { ...action("pro"), href: "#sidebar" },
  { ...action("payments"), href: "#sidebar", badgeCount: 2 },
  { ...action("keys"), href: "#sidebar" },
];
const settingsPanes = stack({
  items: [
    { kind: "block", markup: glassPane({ paneWidth: "full", label: "Hosting", body: stack({ items: [{ kind: "words", markup: html`<h2>Hosting</h2>` }, { kind: "words", markup: html`<p>$18.40 of credit. Each game's first share of hosting is free every month.</p>` }] }) }) },
    { kind: "block", markup: glassPane({ paneWidth: "full", label: "Keys", body: stack({ items: [{ kind: "words", markup: html`<h2>Keys</h2>` }, { kind: "words", markup: html`<p>A key lets your AI tool or the upload command work on your games.</p>` }] }) }) },
  ],
});
const stillSidebar = (id: string, places: SidebarPlace[]) => html`<nav class="sidebar glass glass-pane compact pinned" id="${id}" aria-label="Design" data-glass data-glass-corners="pane">${EDGE}<div class="sidebar-in pane-in">${sidebarPlaces("Design", places)}</div></nav>`;

component({
  name: "Sidebar",
  slug: "sidebar",
  group: "navigation",
  subgroup: "places",
  summary: "A page's own places down its side: the gallery's groups, Developer settings' Hosting, Pro and Keys. A stacked Switch on a floating pane as tall as its places. The place you're on is the slab, and the edge lights beside the one you point at. A group opens like a folder: the one you're in stays open, and opening another shuts the rest. Its button, at the header's start, folds it away and the page glides into the width; on a phone it's Docked glass from the start edge. Never a sidebar built in place.",
  styles: `
/* A sidebar: a floating pane as tall as its places, holding a stacked Switch: the place you're on is the slab, the edge lights beside the one
   you point at. The well scrolls on its own rail past the pane's height, so the pane's glass stays whole and still. */
.sidebar { display: flex; flex-direction: column; --sidebar-is-sheet: 0; }
.sidebar-in { display: flex; flex-direction: column; flex: 0 1 auto; min-height: 0; }
.sidebar .sidebar-in > .well.switch-well { --well-height: none; flex: 0 1 auto; min-height: 0; }
/* On a phone it's its sheet: Docked glass against the start edge, the screen's whole height, stopping a finger's width short of the far edge so the
   page stays in view and a press on it closes the sheet. */
.sheet.placement-start { --sheet-room: var(--touch-target); max-width: none; max-height: none; }
.sheet.placement-start:not(.in-place) { margin: 0; inset: calc(-1 * var(--dock-overhang)) auto calc(-1 * var(--dock-overhang)) calc(-1 * var(--dock-overhang)); width: calc(min(var(--size-sidebar-sheet), 100vw - var(--sheet-room)) + var(--dock-overhang)); height: calc(100dvh + 2 * var(--dock-overhang)); }
.sheet.placement-start.in-place { margin: 0; inset: calc(-1 * var(--dock-overhang)) auto calc(-1 * var(--dock-overhang)) calc(-1 * var(--dock-overhang)); width: calc(100% - var(--sheet-room) + var(--dock-overhang)); height: calc(100% + 2 * var(--dock-overhang)); }
.sheet.placement-start > .sheet-in { height: 100%; box-sizing: border-box; padding: calc(var(--dock-overhang) + var(--pad-frame)) calc(var(--dock-bevel) + var(--pad-frame)) calc(var(--dock-overhang) + var(--pad-frame)) calc(var(--dock-overhang) + var(--pad-frame)); }
/* On its side the screen is short and wide: its places lie in two columns, a folder's name across both, so they fit without scrolling. */
@media ${HEADER_RAIL_MEDIA} {
  .sheet.placement-start:not(.in-place) { width: calc(min(2 * var(--size-sidebar), 100vw - var(--sheet-room)) + var(--dock-overhang)); }
  .sheet.placement-start .tab-switch.vertical { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sheet.placement-start .tab-switch.vertical > .switch-folder { grid-column: 1 / -1; }
  .sheet.placement-start .tab-switch.vertical > .is-in-folder { --row-start: 14px; }
  .sheet.placement-start .tab-switch.vertical .switch-slab { left: 0; right: auto; }
}
/* It slides in from the edge it's docked to, whole: nothing in it fades, only the dimming behind it. */
.sheet.placement-start:not(.in-place):is(:not([open]), .is-leaving, .is-arriving) { transform: translateX(-100%); }
.sheet.placement-start:not(.in-place):is(:not([open]), .is-leaving, .is-arriving)::before, .sheet.placement-start:not(.in-place):is(:not([open]), .is-leaving, .is-arriving) > * { opacity: 1; }
@starting-style { .sheet.placement-start:not(.in-place)[open] { transform: translateX(-100%); } .sheet.placement-start:not(.in-place)[open]::before, .sheet.placement-start:not(.in-place)[open] > * { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .sheet.placement-start:not(.in-place):is(:not([open]), .is-leaving, .is-arriving) { transform: none; } @starting-style { .sheet.placement-start:not(.in-place)[open] { transform: none; } }
}
/* The gallery's still copies: a sidebar as it sits, and a phone's screen with the sheet over its page. */
/* A phone's width, as tall as the sheet in it at any size of text. */
.docked-frame.sidebar-example-phone { width: min(100%, 320px); height: 560px; }
`,
  render: sidebar,
  examples: [
    { label: "Open, a group's subgroups under it", markup: stillSidebar("example-sidebar-nested", GALLERY_GROUPS) },
    { label: "Places with icons and counts", markup: stillSidebar("example-sidebar-icons", SETTINGS_PLACES) },
    {
      label: "On a phone, over the page",
      isStill: true,
      markup: html`<div class="docked-frame header-frame sidebar-example-phone"><div class="backdrop is-framed" aria-hidden="true"></div>${sheetMarkup({ id: "example-sidebar-phone", title: "Design", body: sidebarPlaces("Design", GALLERY_GROUPS), closeButton: tertiaryButton(action("close"), { type: "button", isLabelHidden: true, isSmall: true }), placement: "start", isShown: true })}</div>`,
    },
  ],
});

component({
  name: "Sidebar layout",
  slug: "sidebar-layout",
  group: "layout",
  subgroup: "page",
  after: "page-shape",
  summary: "A Sidebar beside the page: the sidebar in its own column, staying in view while the page scrolls, the page in the rest. Folded, the page takes the whole width; on a reading page the page is its reading column and the pair sits in the middle; on a phone the sidebar is a sheet over the page. Not for places that belong to the whole site: those are the header's.",
  styles: `
/* A Sidebar beside the page: its own column, staying in view under the header while the page scrolls, never taller than the window. It
   comes in fading and sliding a little, and folds away the same way (SIDEBAR_SCRIPT), only then giving its column to the page. */
.sidebar-layout { container: sidebar-layout / inline-size; width: 100%; min-width: 0; }
.sidebar-layout-in { display: grid; grid-template-columns: var(--size-sidebar) minmax(0, 1fr); gap: var(--gap-block-block); align-items: start; }
.sidebar-layout-in > .sidebar { position: sticky; z-index: 1; top: var(--header-room, var(--pad-pane)); max-height: calc(100dvh - var(--header-room, var(--pad-pane)) - var(--pad-pane)); overflow: hidden;
  transition: var(--glass-transition), opacity var(--motion-state), transform var(--motion-state) var(--ease-glide); }
@starting-style { .sidebar-layout-in > .sidebar { opacity: 0; transform: translateX(-24px); } }
/* Folding: the sidebar, held where it was out of the page's way, slides off toward the edge as the page glides into its room. */
.sidebar-layout.is-folding > .sidebar-layout-in > .sidebar { display: block; position: fixed; left: var(--sidebar-left); top: var(--sidebar-top); width: var(--sidebar-width); height: var(--sidebar-height); z-index: 1; }
.sidebar-layout.is-folding > .sidebar-layout-in > .sidebar.is-leaving { opacity: 0; transform: translateX(-24px); }
.sidebar-main { min-width: 0; }
.sidebar-layout.is-collapsed > .sidebar-layout-in { grid-template-columns: minmax(0, 1fr); }
.sidebar-layout.is-collapsed:not(.is-folding) > .sidebar-layout-in > .sidebar { display: none; }
/* A reading page: the page a reading column beside it, the pair in the middle of the wide frame; folded, the column alone in the middle. */
html[data-page-shape="reading"] .sidebar-layout-in { grid-template-columns: var(--size-sidebar) minmax(0, var(--size-page-reading)); justify-content: center; }
html[data-page-shape="reading"] .sidebar-layout.is-collapsed > .sidebar-layout-in { grid-template-columns: minmax(0, var(--size-page-reading)); }
/* Where the page can't have a column beside it (a phone, a tablet with large text), the sidebar is its sheet over the page (Sidebar). */
@container sidebar-layout (max-width: ${SIDEBAR_SHEET_BELOW}) {
  .sidebar-layout-in { grid-template-columns: minmax(0, 1fr); }
  html[data-page-shape="reading"] .sidebar-layout-in { grid-template-columns: minmax(0, var(--size-page-reading)); }
  .sidebar-layout-in > .sidebar { display: none; --sidebar-is-sheet: 1; }
}
/* A phone on its side has no width to give up either: its places are its sheet too. */
@media ${HEADER_RAIL_MEDIA} {
  .sidebar-layout-in { grid-template-columns: minmax(0, 1fr); }
  html[data-page-shape="reading"] .sidebar-layout-in { grid-template-columns: minmax(0, var(--size-page-reading)); }
  .sidebar-layout-in > .sidebar { display: none; --sidebar-is-sheet: 1; }
}
@media (prefers-reduced-motion: reduce) { .sidebar-layout-in > .sidebar { transition: var(--glass-transition); } }
`,
  render: sidebarLayout,
  examples: [
    { label: "Beside a page", isWide: true, isStill: true, markup: sidebarLayout({ sidebar: stillSidebar("example-sidebar-beside", SETTINGS_PLACES), main: settingsPanes }) },
    {
      label: "Folded: the page has the whole width",
      isWide: true,
      isStill: true,
      markup: sidebarLayout({ sidebar: stillSidebar("example-sidebar-folded", SETTINGS_PLACES), main: settingsPanes, isCollapsed: true }),
    },
  ],
});


/**
 * Load more: pressing it fetches its page, adds what's in that page's list of the same id to this one, and puts that page's own
 * Load more in its place (or its end words, or nothing, at the end). It's busy while it waits; if the page doesn't come, it says so under
 * the button and can be pressed again, and if the page has no list of that id, it goes there instead.
 */
export const LOAD_MORE_SCRIPT = `/* load more */(function () {
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("[data-load-more] > a.shell[href]");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var holder = link.parentElement, ids = holder.getAttribute("data-load-more").split(" "), list = document.getElementById(ids[0]), words = holder.querySelector(".load-more-words");
    if (!list) return;
    event.preventDefault();
    if (link.getAttribute("aria-busy") === "true") return;
    window.zaismaWait(link, fetch(link.href, { headers: { accept: "text/html" }, credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.text();
    }).then(function (text) {
      var next = new DOMParser().parseFromString(text, "text/html");
      if (!next.getElementById(list.id)) { location.href = link.href; return; }
      ids.forEach(function (id) {
        var into = document.getElementById(id), more = next.getElementById(id);
        if (!into || !more || !more.children.length) return;
        Array.prototype.slice.call(more.children).forEach(function (child) { into.appendChild(document.importNode(child, true)); });
        // A list that scrolls inside itself (capped list rows) fades and shows its rail from how far it can scroll: more rows means that changed.
        into.dispatchEvent(new Event("scroll"));
        var hidden = into.closest("[hidden]");
        if (hidden) hidden.hidden = false;
      });
      var after = next.querySelector("[data-load-more]");
      if (after) { var placed = document.importNode(after, true); holder.replaceWith(placed); watch(placed); } else holder.remove();
    }).catch(function () {
      holder.classList.add("is-failed");
      if (words) { words.textContent = ${JSON.stringify(LOAD_FAILED_TEXT)}; words.hidden = false; }
    }));
  });
  // One that loads on scroll is pressed once it's within a screen of view, and only after the player has moved the page (a scroll, a wheel or
  // a swipe, even on a page that fits its screen and can't scroll), so a page just opened stays as it first painted. A failed one waits to be
  // pressed again.
  var nearScreen = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var link = entry.target.querySelector("a.shell[href]");
      if (entry.isIntersecting && link && !entry.target.classList.contains("is-failed")) link.click();
    });
  }, { rootMargin: "100% 0px" }) : null;
  var untilMoved = [], MOVES = ["scroll", "wheel", "touchmove"];
  function moved() {
    if (!untilMoved) return;
    untilMoved.forEach(function (holder) { nearScreen.observe(holder); });
    untilMoved = null;
    MOVES.forEach(function (name) { removeEventListener(name, moved, true); });
  }
  function watch(holder) {
    if (!nearScreen || !holder.hasAttribute("data-loads-on-scroll")) return;
    if (untilMoved) untilMoved.push(holder); else nearScreen.observe(holder);
  }
  document.querySelectorAll("[data-loads-on-scroll]").forEach(watch);
  if (nearScreen) {
    MOVES.forEach(function (name) { addEventListener(name, moved, { capture: true, passive: true }); });
    // Back on a page the browser put part way down: it has already moved.
    if (window.scrollY > 0) moved();
  }
  // A page that swaps its list for another (Browse, as you type a search) hands the new one's Load more here.
  window.zaismaLoadMore = { watch: watch };
})();
`;

/** The example's first page of versions; the gallery serves the next two (design-page.ts, olderVersionsPage). */
const LOADED_ROWS = [14, 13, 12].map((versionNumber) => ({ title: `Version ${versionNumber}`, detail: versionNumber === 14 ? "Live · 2 days ago" : `Replaced · ${16 - versionNumber} weeks ago`, href: "#load-more" }));

component({
  name: "Load more",
  slug: "load-more",
  group: "navigation",
  subgroup: "scrolling",
  summary: "The next page added in place, busy while it comes. A list or a table has it as its last row (moreRows); under a grid of covers it loads by itself as you scroll. Without scripts it's a link to that page.",
  styles: `
/* Load more: a full-width secondary button, with what went wrong under it as a control's words; or, once the list has ended, a line of words saying so. */
.load-more { display: flex; flex-direction: column; gap: var(--gap-words-control); }
.load-more-words { margin: 0; font: var(--type-note); color: var(--muted); }
.load-more.is-failed .load-more-words { color: var(--marked); }
`,
  render: loadMore,
  examples: [
    { label: "As a list's last row: try it, to the last page", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(listRows({ whenEmpty: stateNote({ stateKind: "empty", title: "No older versions yet", text: "Each version you publish shows here." }), id: "example-load-more-list", rows: LOADED_ROWS, moreRows: { href: "/design/examples/older-versions?page=2", label: "Show older versions" } })) }) },
    { label: "Busy", markup: html`<div style="width:min(340px,100%)">${secondaryButton("Show older versions", { href: "#load-more", isFullWidth: true, isBusy: true })}</div>`, isStill: true },
    { label: "After a failed load: press it again", isWide: true, isStill: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(listRows({ whenEmpty: stateNote({ stateKind: "empty", title: "No older versions yet", text: "Each version you publish shows here." }), id: "example-load-failed-list", rows: LOADED_ROWS, moreRows: { href: "#load-more", label: "Show older versions", isFailed: true } })) }) },
    { label: "At the end of the list", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(listRows({ whenEmpty: stateNote({ stateKind: "empty", title: "No older versions yet", text: "Each version you publish shows here." }), id: "example-load-end-list", rows: LOADED_ROWS, moreRows: { label: "Show older versions", endText: "That's every version." } })) }) },
  ],
});

/** One way a Filter menu narrows a list (Genre, Players, Price): its choices, each a link to the list with it picked. */
export interface FilterGroup {
  /** Its key in the menu, lowercase: "genre". */
  groupName: string;
  label: string;
  /** What it narrows by, at a glance, before its label: every way has one, so their words line up with Clear filters'. */
  icon: ListedIcon;
  /** What's picked now, said beside its label: "Adventure", or "Any". */
  pickedLabel: string;
  choices: { label: string; href: string; isCurrent: boolean }[];
}

export interface FilterMenuOptions {
  /** The menu's id, which its button controls. */
  id: string;
  groups: FilterGroup[];
  /** The list with nothing filtered, for Clear filters, which shows only while something is (filterCount above 0). */
  clearHref: string;
  /** How many filters are in use, on the button; 0 for none. */
  filterCount: number;
  /** The gallery's fixed states: open, and on one group's choices. */
  isOpen?: boolean;
  openGroupName?: string;
}

/**
 * The Filter menu: a button that opens a dropdown of the ways to narrow a list, each with what's picked. Choosing one turns the menu to
 * that group's choices, with a way back at its top, in the same pane, so a mouse and a thumb use it alike; choosing a choice follows its link.
 */
export function filterMenu(options: FilterMenuOptions): ControlMarkup {
  // A choice is a Dropdown's (its classes and look), a link to the list with it picked.
  const choice = (label: string, href: string, isCurrent: boolean, choiceIcon?: IconName, isHidden = false) =>
    html`<a href="${href}" class="${DROPDOWN_CHOICE_CLASS}" role="menuitem" tabindex="-1" data-lights data-keeps-open data-cut-line="8"${isCurrent ? raw(' aria-current="page"') : ""}${isHidden ? raw(" hidden") : ""}>${CUT_LINE}${choiceIcon ? icon(choiceIcon) : ""}<span>${label}</span>${isCurrent ? DROPDOWN_TICK : ""}</a>`;
  const button = secondaryButton(action("filter"), { type: "button", controls: options.id, isExpanded: Boolean(options.isOpen), reactionCount: options.filterCount || undefined });
  const opener = (groupName: string, inside: Raw, className: string) =>
    html`<button type="button" class="${DROPDOWN_CHOICE_CLASS} ${className}" role="menuitem" tabindex="-1" aria-haspopup="menu" data-lights data-cut-line="8" data-filter-opens="${groupName}">${CUT_LINE}${inside}</button>`;
  const main = html`<div class="dropdown-in filter-panel" data-filter-panel=""${options.openGroupName ? raw(" hidden") : ""}>${options.groups.map((group) =>
    opener(group.groupName, html`${icon(group.icon)}<span>${group.label}</span><span class="filter-picked">${group.pickedLabel}</span>${icon("chevron-right")}`, "filter-group"),
  )}${options.filterCount ? divider() : raw('<hr class="divider hairline" role="separator" hidden>')}${choice("Clear filters", options.clearHref, false, "close", !options.filterCount)}</div>`;
  const panels = options.groups.map(
    (group) =>
      html`<div class="dropdown-in filter-panel" data-filter-panel="${group.groupName}"${options.openGroupName === group.groupName ? "" : raw(" hidden")}>${opener("", html`${icon("arrow-back")}<span>${group.label}</span>`, "filter-back")}<hr class="hairline" role="separator">${group.choices.map((each) => choice(each.label, each.href, each.isCurrent))}</div>`,
  );
  const menu = floatingPane({ id: options.id, placement: "under", kind: "dropdown filter-menu", role: "menu", label: "Filter", edgeLight: "left", isShownInPlace: options.isOpen, body: html`${main}${panels}` });
  return controlMarkup(html`${button}${menu}`, "regular");
}

/** A Filter menu turns to a group's choices and back in place, and starts again from its groups each time it opens. */
export const FILTER_MENU_SCRIPT = `/* filter menus */(function () {
  var isStill = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The ways in use (picked other than their first choice, Any): counted on the Filter button, and Clear filters shown while there are any.
  function recount(menu) {
    var inUse = 0;
    menu.querySelectorAll('[data-filter-panel]:not([data-filter-panel=""])').forEach(function (panel) { var first = panel.querySelector('a[role="menuitem"]'); if (first && first.getAttribute("aria-current") !== "page") inUse++; });
    var button = document.querySelector('[aria-controls="' + menu.id + '"]'), slab = button && button.querySelector(".slab"), count = button && button.querySelector(".cut-count");
    if (inUse && !count && slab) { count = document.createElement("span"); count.className = "cut-count"; slab.appendChild(count); }
    if (count) { if (inUse) count.textContent = String(inUse); else count.remove(); }
    var clear = menu.querySelector('[data-filter-panel=""] a[role="menuitem"][data-keeps-open]'), rule = clear && clear.previousElementSibling;
    if (clear) clear.hidden = !inUse;
    if (rule && rule.matches("hr")) rule.hidden = !inUse;
    if (menu.zaismaPlace) menu.zaismaPlace();
  }
  function show(menu, groupName, isFocused) {
    var shown = null, was = menu.querySelector("[data-filter-panel]:not([hidden])");
    menu.querySelectorAll("[data-filter-panel]").forEach(function (panel) { panel.hidden = panel.getAttribute("data-filter-panel") !== groupName; if (!panel.hidden) shown = panel; });
    if (menu.zaismaPlace) menu.zaismaPlace();
    // Into a way's choices it slides in from the end, back to the ways from the start: a short step sideways, never a pop.
    if (shown && was && shown !== was && !isStill && shown.animate) shown.animate([{ transform: "translateX(" + (groupName ? 12 : -12) + "px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    if (isFocused && shown) {
      // Back from a group, its row in the groups is focused again; into one, its picked choice, or else its first.
      var back = groupName === "" && menu.lastGroupName ? menu.querySelector('[data-filter-opens="' + menu.lastGroupName + '"]') : null;
      var target = back || shown.querySelector('[aria-current="page"]') || shown.querySelector('[role="menuitem"]');
      if (target) target.focus({ preventScroll: true });
    }
  }
  window.zaismaWatch.each(".filter-menu", function (menu) {
    menu.addEventListener("click", function (event) {
      // A way's choice picked: it's marked picked there and named on its way's row, and the menu goes back to its ways, that row in focus.
      // Its page applies it (Browse draws its list again, the menu open on its ways).
      // Clear filters: every way back to its first choice (Any), the count gone from the Filter button, and Clear filters with it.
      var clear = event.target.closest('[data-filter-panel=""] a[role="menuitem"][data-keeps-open]');
      if (clear) {
        menu.querySelectorAll('[data-filter-panel]:not([data-filter-panel=""])').forEach(function (panel) {
          var first = panel.querySelector('a[role="menuitem"]'), tick = menu.querySelector(".dropdown-tick");
          if (!first || first.getAttribute("aria-current") === "page") return;
          tick = tick && tick.cloneNode(true);
          panel.querySelectorAll('[aria-current="page"]').forEach(function (each) { each.removeAttribute("aria-current"); var own = each.querySelector(".dropdown-tick"); if (own) own.remove(); });
          first.setAttribute("aria-current", "page"); if (tick) first.appendChild(tick);
          var row = menu.querySelector('[data-filter-opens="' + panel.getAttribute("data-filter-panel") + '"] .filter-picked'), label = first.querySelector("span");
          if (row && label) row.textContent = label.textContent;
        });
        recount(menu);
        var firstWay = menu.querySelector(".filter-group");
        if (firstWay) firstWay.focus({ preventScroll: true });
        if (menu.zaismaPlace) menu.zaismaPlace();
        return;
      }
      var picked = event.target.closest('[data-filter-panel]:not([data-filter-panel=""]) [role="menuitem"][data-keeps-open]');
      if (picked) {
        var panel = picked.closest("[data-filter-panel]"), groupName = panel.getAttribute("data-filter-panel"), tick = menu.querySelector(".dropdown-tick");
        tick = tick && tick.cloneNode(true);
        panel.querySelectorAll('[aria-current="page"]').forEach(function (each) { each.removeAttribute("aria-current"); var own = each.querySelector(".dropdown-tick"); if (own) own.remove(); });
        picked.setAttribute("aria-current", "page");
        if (tick) picked.appendChild(tick);
        var row = menu.querySelector('[data-filter-opens="' + groupName + '"]'), label = picked.querySelector("span");
        if (row && label && row.querySelector(".filter-picked")) row.querySelector(".filter-picked").textContent = label.textContent;
        menu.lastGroupName = groupName;
        recount(menu);
        show(menu, "", true);
        return;
      }
      var opener = event.target.closest("[data-filter-opens]");
      if (!opener) return;
      var groupName = opener.getAttribute("data-filter-opens");
      if (groupName) menu.lastGroupName = groupName;
      show(menu, groupName, event.detail === 0);
    });
    menu.addEventListener("keydown", function (event) {
      var item = document.activeElement;
      if (event.key === "ArrowRight" && item && item.matches(".filter-group")) { event.preventDefault(); menu.lastGroupName = item.getAttribute("data-filter-opens"); show(menu, menu.lastGroupName, true); }
      if (event.key === "ArrowLeft" && item && item.closest('[data-filter-panel]:not([data-filter-panel=""])')) { event.preventDefault(); show(menu, "", true); }
    });
    // Opened, it always starts on its ways, whichever it was on when it shut.
    menu.addEventListener("beforetoggle", function (event) { if (event.newState === "open") show(menu, "", false); });
  });
})();
`;

const filterMenuFrame = (options: FilterMenuOptions) => html`<div class="dropdown-frame">${filterMenu(options)}</div>`;
const EXAMPLE_FILTER_GROUPS: FilterGroup[] = [
  { groupName: "genre", ...action("genre"), pickedLabel: "Adventure", choices: ["Any", "Action", "Adventure", "Role-playing", "Strategy"].map((label) => ({ label, href: "#filter-menu", isCurrent: label === "Adventure" })) },
  { groupName: "players", ...action("players"), pickedLabel: "Any", choices: ["Any", "Single-player", "Multiplayer"].map((label) => ({ label, href: "#filter-menu", isCurrent: label === "Any" })) },
  { groupName: "price", ...action("price"), pickedLabel: "$15 to $30", choices: ["Any price", "Free", "Under $5", "$5 to $15", "$15 to $30", "$30 and up"].map((label) => ({ label, href: "#filter-menu", isCurrent: label === "$15 to $30" })) },
];

component({
  name: "Filter menu",
  slug: "filter-menu",
  group: "panes",
  subgroup: "menus",
  summary: "The ways to narrow a list, in one menu from a Filter button that counts the ones in use: each way says what's picked, and opens its choices in the same pane, with a way back. Not for one order to sort by: a Dropdown.",
  styles: `
/* A Filter menu: a Dropdown whose rows each open a group's choices in its place (a group's row ends in what's picked and a chevron),
   and whose group's choices start with the way back. It's at least wide enough for its longest group and what's picked in it. */
.floating-pane.filter-menu { min-width: min(15rem, 100%, calc(100vw - 2 * var(--pad-frame))); }
.filter-panel[hidden] { display: none; }
.filter-group > .filter-picked { margin-left: auto; color: var(--muted); font: var(--type-facts); }
.filter-group > .ico:last-child, .filter-back > .ico { flex: none; width: 12px; height: 12px; }
.filter-back { font: var(--type-name); color: var(--ink); }
`,
  render: filterMenu,
  examples: [
    { label: "Closed, two filters in use", markup: row({ widths: "fit", alignment: "end", items: [{ kind: "control", markup: filterMenu({ id: "example-filter-closed", groups: EXAMPLE_FILTER_GROUPS, clearHref: "#filter-menu", filterCount: 2 }) }] }) },
    { label: "Open: the ways to filter, each with what's picked", markup: filterMenuFrame({ id: "example-filter-open", groups: EXAMPLE_FILTER_GROUPS, clearHref: "#filter-menu", filterCount: 2, isOpen: true }) },
    { label: "On one way's choices, the picked one marked", markup: filterMenuFrame({ id: "example-filter-price", groups: EXAMPLE_FILTER_GROUPS, clearHref: "#filter-menu", filterCount: 2, isOpen: true, openGroupName: "price" }), isStill: true },
    { label: "Nothing filtered yet: no count, no Clear filters", markup: filterMenuFrame({ id: "example-filter-none", groups: EXAMPLE_FILTER_GROUPS.map((group) => ({ ...group, pickedLabel: group.groupName === "price" ? "Any price" : "Any" })), clearHref: "#filter-menu", filterCount: 0, isOpen: true }) },
  ],
});

/** The header waiting on a new page, in its frame, for the Waiting component's examples (waiting.ts), which show every use. */
export const WAITING_HEADER_EXAMPLE: Raw = headerFrame(header({ id: "example-waiting-header", current: "home", account: null, isOnDeveloperPage: false, isWaiting: true }));
