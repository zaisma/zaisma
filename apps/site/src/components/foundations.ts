import { SIZED_IMAGE_WIDTHS_PX } from "@zaisma/core";
import { html, raw, shownColor, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { ICONS, LOGO_STYLES, MARK, WORDMARK, icon, largeIcon, type IconName } from "./icons.ts";
import { CLOUDS_SHADER, DUSK_SHADER, STAND_IN_BACKGROUNDS } from "./shaders.ts";
import { pageScript, type PageScript } from "../page-scripts.ts";
import { STAND_IN_COVER_PICTURES } from "../generated/stand-in-placeholders.generated.ts";

/*
 * The foundations of Zaisma's look: the tokens every component takes its colors from (tokens.ts), the glass and its
 * drawn rim (glass-script.ts), the backdrop (backdrop-script.ts), the cut shapes, the motion and the line icons (icons.ts).
 * From the drafts Julius approved (ops docs/drafts/look-and-voice/). "Zaisma is the glass, and the game is not"; orange
 * only on what you act on. Everything the other component files import from here is re-exported below.
 */
export { ICONS, MARK, WORDMARK, icon, largeIcon, type IconName } from "./icons.ts";
export { TOKEN_STYLES, cutPolygon } from "./tokens.ts";
import { cutPolygon } from "./tokens.ts";
import { paneParts, row, type ControlMarkup, type LayoutMarkup, stackOfOne } from "./layout.ts";
export { GLASS_SCRIPT, WATCH_SCRIPT } from "./glass-script.ts";

/** The backdrop's still: soft light in the theme's colors, shown until a shader draws, wherever WebGL is missing, and while it's lost. */
const BACKDROP_STILL = "radial-gradient(60% 55% at 22% 28%, var(--backdrop-a), transparent 70%), radial-gradient(55% 55% at 78% 68%, var(--backdrop-b), transparent 70%), radial-gradient(45% 40% at 52% 4%, var(--backdrop-c), transparent 70%), var(--backdrop-base)";
export { BACKDROP_SCRIPT } from "./backdrop-script.ts";


export const MINUTE_MS = 60_000;

/** "12 min ago", "3 h ago", "yesterday", "5 days ago": the home draft's way of saying when. */
export function ago(durationMs: number): string {
  const minuteCount = Math.max(1, Math.round(durationMs / MINUTE_MS));
  if (minuteCount < 60) return `${minuteCount} min ago`;
  if (minuteCount < 1440) return `${Math.round(minuteCount / 60)} h ago`;
  const dayCount = Math.round(minuteCount / 1440);
  return dayCount === 1 ? "yesterday" : `${dayCount} days ago`;
}

export interface GlassPaneOptions {
  /**
   * "full": as wide as what holds it. "fit": as wide as what's in it, its paragraphs running to a reading width (--size-reading) at
   * most. A pane never takes a width of its own: one that should take half the screen is a column of a full-width columns layout.
   */
  paneWidth: "full" | "fit";
  body: LayoutMarkup;
  label?: string;
  /**
   * On a phone the pane starts lower on the screen, so the art behind it shows above it, as a console game hub lets it fill the screen
   * with the title and Play below (the game's page). It never starts so low that the pane's first part, Play included, runs off the screen.
   */
  isStartedLow?: boolean;
  /**
   * A fit pane placed straight in a page's column sits at the column's start, not its middle: the game's page, whose pane stands at the
   * left with the game's world beside it. Left out, a fit pane sits in the column's middle, under the header's.
   */
  isAtStart?: boolean;
}

/**
 * A pane of Zaisma's glass (panes.ts's Glass pane shows it): cut corners (the pane cut tokens), a drawn rim, clear glass. Long content
 * scrolls inside it, so nothing in it shrinks. It pads at the frame gap, and its words keep its margin (--pad-words).
 */
export function glassPane(options: GlassPaneOptions): Raw {
  return html`<section class="glass glass-pane ${options.paneWidth}${options.isStartedLow ? " is-started-low" : ""}${options.isAtStart ? " is-at-start" : ""}" data-glass data-glass-corners="pane"${options.label ? html` aria-label="${options.label}"` : ""}>${EDGE}<div class="pane-in scrolls">${options.body}</div></section>`;
}

export interface FloatingPaneOptions {
  /** Unique on the page: what opens it names it (aria-controls). */
  id: string;
  /** What stays at its top as its body scrolls (a menu's head: whose account, whether you're online). */
  head?: Raw;
  /** What's in it: past the pane's height (a menu's, or the room in the window), it scrolls inside it, with the rail and fades. */
  body: Raw;
  /**
   * Where it hangs from what opens it (its anchor): "under" it, or above it where there's no room below (a search's list, a menu), or "over"
   * it, the line its owner names on the anchor's own line, so a pick sits where the anchor's words were (a select's list, the wheels).
   */
  placement: "under" | "over";
  /** Its owner's own classes, for the owner's styles and script: "select-list". */
  kind?: string;
  /** It holds edged parts beside words (a color picker, wheels), not a list of rows: they sit at the regular frame gap, not a menu's compact one. */
  hasParts?: boolean;
  /** Its role and what a screen reader calls it, when it isn't a list the owner names (a menu, a group of wheels). */
  role?: "menu" | "group";
  /** Its rim lights beside the part you point at (Edge light), along its left side: a menu's choices, which carry data-lights. */
  edgeLight?: "left";
  label?: string;
  /** Shown open where it is, in the page's flow: the gallery's still open states. Over, it lies on its anchor by lineFromTop (a CSS length). */
  isShownInPlace?: boolean;
  lineFromTop?: string;
}

/**
 * A floating pane: a pane of the menus' glass that hangs from what opens it, under it or over it, over everything on the page, casting a
 * shadow onto it. FLOATING (PLACE_SCRIPT's zaismaFloat) does all its floating: lifting it out to the page, its light or dark and hue, where it
 * goes and keeping it in the window, riding the page as it scrolls, closing on Esc, a press elsewhere or a scroll away, and its shadow. It's
 * no taller than a menu or the room in the window, and its body scrolls inside it past that, with the rail and scroll fades.
 */
export function floatingPane(options: FloatingPaneOptions): Raw {
  const className = [`placed-${options.placement}`, options.kind ?? "", options.hasParts ? "regular" : "", "glass", options.isShownInPlace ? "in-place" : ""].filter(Boolean).join(" ");
  return html`<div class="floating-pane ${className}" id="${options.id}"${options.role ? html` role="${options.role}"` : ""}${options.label ? html` aria-label="${options.label}"` : ""} data-glass data-glass-corners="menu"${options.edgeLight ? html` data-edge-light="${options.edgeLight}"` : ""}${
    options.isShownInPlace ? (options.lineFromTop ? html` style="--line-from-top: ${options.lineFromTop}"` : "") : raw(' popover="manual"')
  }>${EDGE}${options.edgeLight ? EDGE_LIGHT : ""}${options.head ? html`<div class="floating-head">${options.head}</div>` : ""}<div class="floating-body scrolls">${options.body}</div></div>`;
}

export interface WellOptions {
  /** What's carved into it: words, code, or a line of them with an icon. */
  body: Raw;
  /** One gallery control at its end, as far in from its end as from its top (a field's Copy); what's in it stops short of it. */
  end?: ControlMarkup;
  /** What shows over the end control for a moment, in its place (a field's Copied tick); its owner shows it. */
  endNote?: Raw;
  /** Its owner's name for it, for the owner's own styles and script, ending in -well so it never meets another component's class: "code-well";
   * the owner's own modifiers may follow it ("switch-well small"). */
  kind?: string;
  /** The gallery's fixed keyboard focus on what's in it. */
  state?: "is-focused";
  /** You press it as a whole (a field you copy from by pressing it anywhere): a field's height, with the carving's pointed and pressed states. */
  isUsed?: boolean;
  /** What's in it is longer than it can show: it scrolls inside the well, which stays still, fading at its ends, on Zaisma's rail; down (a
   * list of choices, a stacked switch's places, the rail beside them) or across (a switch's tabs, the rail under the well). */
  scrollDirection?: "down" | "across";
  /** How far the edge rule cuts its corners, in pixels: 10 unless its owner is smaller (a small switch's 9). */
  cornerCutPx?: number;
  /** It holds parts you point at (a compact list's cards): its edge lights beside the pointed one (Edge light), along this side. */
  edgeLight?: "left" | "bottom";
}

/**
 * A well: a box carved into a pane's glass that holds things (words, code, a list of controls) and is never a control itself: a field or a
 * carved button is carved the same way but is what you use, so it isn't a well; a list of choices down a carving is held in one. Its insides
 * sit at a field's inset, and it's cut by the edge rule. A pane is glass raised; a well is glass carved in. One gallery control can sit at
 * its end, as far in from its end as from its top; what's longer than it can show scrolls inside it.
 */
export function well(options: WellOptions): Raw {
  const isAcross = options.scrollDirection === "across";
  const className = ["well", "carving", options.isUsed ? "is-used sized" : "", options.kind ?? "", options.scrollDirection ? `scrolls-${options.scrollDirection}` : "", options.state ?? ""].filter(Boolean).join(" ");
  const bodyClass = ["well-body", "carving-words", options.scrollDirection ? "scrolls" : "", isAcross ? "across" : ""].filter(Boolean).join(" ");
  return html`<div class="${className}" data-cut-line="${options.cornerCutPx ?? 10}"${isAcross ? raw(" data-side-rail") : ""}${options.edgeLight ? html` data-edge-light="${options.edgeLight}"` : ""}>${CUT_LINE}${options.edgeLight ? EDGE_LIGHT : ""}<div class="${bodyClass}"${isAcross ? raw(" data-fades-sideways data-rail-scroller") : ""}>${options.body}</div>${
    options.end ? html`<div class="well-end carving-end">${options.end}${options.endNote ? html`<span class="well-end-note" aria-hidden="true">${options.endNote}</span>` : ""}</div>` : ""
  }</div>`;
}

/**
 * A tray: one sheet of glass holding a whole area under its head, so what's in the area reads as one with it (the gallery's sections: a
 * head of words, then every example on the tray). The sheet is the thinnest glass, light or smoked, with one rim round all of it at a
 * pane's cuts; its head is a step of thicker glass across its top, under the same rim, with none of its own: the step's lip catches the
 * light and shades the thin glass below it (materials.ts). What sits on a tray fits it like anything on a pane: square under the head,
 * cut at an even gap into its cut foot.
 * What has an edge sits on it at the frame gap, like a pane's; its words are closer than a pane's (--pad-tray), and its foot's cuts
 * smaller (16 and 12), still a bevel at what sits in its corners.
 */
export function tray(options: { head: Raw; body: LayoutMarkup; label?: string; paneWidth?: "full" | "fit" }): Raw {
  return html`<section class="glass tray-group ${options.paneWidth ?? "full"}" data-glass data-glass-corners="pane-large pane-small 16 12"${options.label ? html` aria-label="${options.label}"` : ""}>${EDGE}<div class="glass tray-head">${options.head}</div><div class="tray">${options.body}</div></section>`;
}

/** Zaisma's logo, a link home: the wordmark (the header, the gallery's bar) or the mark alone (the footer). --logo-height sets its size. */
export const logo = (kind: "wordmark" | "mark"): Raw =>
  html`<a class="logo ${kind}" href="/" aria-label="Zaisma home">${kind === "wordmark" ? WORDMARK : MARK}</a>`;

/** The logo on light or smoked glass whatever the page's theme, for the gallery. */
const logoOn = (glassKind: "light" | "smoked", markup: Raw): Raw =>
  html`<div ${glassKind === "light" ? raw('data-theme-choice="light"') : raw('class="smoke"')} style="display:flex;padding:var(--pad-pane);background:${glassKind === "light" ? "#E7E4DF" : "#121110"}">${markup}</div>`;

/**
 * A divider (reading.ts's Divider): a hairline across a pane between two parts of it (a menu's head and its choices, a group of choices
 * and Clear filters), or, with words in its middle, between two ways to do one thing (or). isDecorative: it only sets parts apart, and a
 * screen reader passes over it.
 */
export function divider(options: { words?: string; isDecorative?: boolean } = {}): Raw {
  if (options.words) return html`<p class="divider has-words words-margin"><span class="hairline"></span><span>${options.words}</span><span class="hairline"></span></p>`;
  return options.isDecorative ? raw('<hr class="divider hairline" aria-hidden="true">') : raw('<hr class="divider hairline" role="separator">');
}


/** A rail's parts: its channel, carved with slanted ends, and inside it the groove the thumb slides in. */
export const RAIL_PARTS = '<div class="rail-line carving deep"><div class="rail-groove"><div class="rail-thumb"></div></div></div>';
/** Zaisma's own scrollbar (navigation.ts's rail, RAIL_SCRIPT): "box" for a box that scrolls (it goes just after it), "page" for the page. */
export const railMarkup = (scrollKind: "box" | "page" | "side"): Raw => raw(`<div class="rail${scrollKind === "side" ? " sideways" : ""}" data-rail="${scrollKind}" aria-hidden="true">${RAIL_PARTS}</div>`);

/**
 * A tag: a few words or a number, slanted at both ends, on what it labels. "new" is green (Updated, Live), "count" a number in the buttons'
 * face (unread topics), "plain" words in the same face (Replaced, Developer), "warning" amber (Held, Over the limit), "glass" a sliver of the
 * menus' glass (the rail's labels), "new-on-glass" that glass with the new words' green (Updated over a game card's art). An icon before its
 * words says what kind it is at a glance. With removeHref it takes itself away: a
 * link to the page without it, its words then a close mark (a filter in use). data.ts's Tag shows it.
 */
export type TagTone = "new" | "count" | "plain" | "warning" | "glass" | "new-on-glass";
export const tag = (words: string | number, tone: TagTone, options: { icon?: IconName; removeHref?: string } = {}): Raw =>
  options.removeHref !== undefined
    ? html`<a class="tag ${tone} is-removable" href="${options.removeHref}" aria-label="Remove ${String(words)}"><span>${String(words)}</span>${icon("close")}</a>`
    : html`<span class="tag ${tone === "new-on-glass" ? "glass is-new" : tone}">${options.icon ? html`${icon(options.icon)}<span>${String(words)}</span>` : String(words)}</span>`;

export interface ColorChoice {
  /** What it's called, said by a screen reader and shown in its field when it's picked (a Color field's named colors). */
  name: string;
  /** The value a page script reads (data-color-value). */
  colorValue: string;
  /** What the swatch shows: a color, or "clear" for a checker (see-through, or none). */
  swatch: string;
}


export interface SheetMarkupOptions {
  /** Unique on the page: what opens it names it (aria-controls). */
  id: string;
  title: string;
  /** Its words and fields, which scroll between its head and its buttons when they're long. */
  body: Raw;
  /** Its Close (actions.ts's secondaryButton: small, only its icon, formmethod="dialog"), in its head's corner. */
  closeButton: ControlMarkup;
  /** Its buttons, an equal row at its foot, in view while the body scrolls: the way out first, the one thing to do last. */
  buttons?: ControlMarkup[];
  /** Where its form posts when a button sends it. Without one, a button that sends it only closes it. */
  action?: string;
  /** Controls pinned at its foot in place of buttons (a stack of them), in view while the body scrolls: a store panel's card row and Buy. */
  foot?: Raw;
  /** "center" over the dimmed page; "foot" risen from the screen's foot over a running game, not dimming it; "corner" at the screen's bottom right over a running game, as tall as what's in it, not dimming it (a store panel over a game); "middle" in the middle of the screen on a wide screen whatever opened it, never hung from a button (Confirm it's you); "start" a tall panel sliding in from the screen's start edge over the page (a sidebar on a phone). */
  placement?: "center" | "foot" | "corner" | "middle" | "start";
  /** A store panel (panes.ts): a store panel's own width, in either placement. */
  isStorePanel?: boolean;
  /** Shown in place, not over the page: the gallery's still copies. */
  isShown?: boolean;
  /** On a wide screen, a narrow sheet with its gaps closed up, so it reads as a dropdown (the share sheet's QR code and link); on a phone it's like any sheet. */
  isCompact?: boolean;
  /** A picture large (a screenshot, a screen on Screens): as wide as the screen allows, up to --size-sheet-picture, rather than --size-sheet. */
  isPicture?: boolean;
  /** What its form holds in place of one head, body and foot: a sheet's steps, or its tabs (panes.ts's sheet), each made of Pane parts. */
  parts?: Raw;
  /** The id of the title that names it, when parts hold it: its first step's. */
  titleId?: string;
  /** A short yes or no that guards something (a confirm sheet, Confirm it's you): opened over another sheet it's drawn a size smaller, in the middle of it. */
  isConfirm?: boolean;
}

/**
 * A sheet (panes.ts's Sheet shows it, and so is a Confirm sheet): a <dialog> of the panes' glass, one form, with its title and
 * Close in its head's corner (Pane parts), its body scrolling under the head, and its buttons at its foot. Close and Cancel close it
 * without sending it (formmethod="dialog"). Here, so actions.ts can make one without a loop of imports.
 */
export function sheetMarkup(options: SheetMarkupOptions): Raw {
  const buttons = options.buttons ?? [];
  const parts = paneParts({
    head: { words: html`<h2 class="sheet-title" id="${options.id}-title">${options.title}</h2>`, end: options.closeButton },
    body: html`<div class="sheet-scroll"><div class="sheet-body scrolls to-edge">${options.body}</div></div>`,
    foot: options.foot ? { start: { kind: "block", markup: options.foot } } : buttons.length ? { start: { kind: "block", markup: row({ widths: "equal", items: buttons.map((button) => ({ kind: "control" as const, markup: button })) }) } } : undefined,
  });
  const inside = options.parts ?? parts;
  const form = options.action === undefined ? html`<form class="sheet-in scrolls" method="dialog">${inside}</form>` : html`<form class="sheet-in scrolls" method="post" action="${options.action}">${inside}</form>`;
  return html`<dialog class="sheet glass${options.placement === "foot" ? " placement-foot" : options.placement === "corner" ? " placement-corner" : options.placement === "middle" ? " placement-middle" : options.placement === "start" ? " placement-start" : ""}${options.isStorePanel ? " store-panel" : ""}${options.isCompact ? " is-compact" : ""}${options.isPicture ? " is-picture" : ""}${options.isShown ? " in-place" : ""}" id="${options.id}" aria-labelledby="${options.titleId ?? `${options.id}-title`}"${options.isConfirm ? raw(" data-sheet-confirm") : ""} data-glass data-glass-corners="pane"${options.isShown ? raw(" open") : ""}>${EDGE}${form}</dialog>`;
}

/** An outline for a cut field or button (GLASS_SCRIPT draws it), and a slab's drawn rim. */
export const CUT_LINE = raw('<svg class="cut-line" aria-hidden="true"><polygon/></svg>');
export const EDGE = raw('<svg class="edge" aria-hidden="true"></svg>');
/**
 * An edge light (Panes › Glass): the light a well or pane catches on its edge, laid in it before what it holds. The holder names the edge
 * (data-edge-light="bottom" or "left"), and the parts that light it carry data-lights (a switch's tabs); EDGE_LIGHT_SCRIPT does the rest.
 */
export const EDGE_LIGHT = raw('<span class="edge-light" aria-hidden="true"></span>');

export interface GrooveOptions {
  /** How much of it is filled with light, from its start: 0 to 100. Left out, a light runs along it: on its way, with no end known yet. */
  filledPct?: number;
  /** Its owner's name for it, for the owner's own styles: "slider-groove". */
  kind?: string;
  /** It's still going (an upload on its way): a glint runs along its light, over and over, so it plainly isn't stuck. */
  isWorking?: boolean;
  /** What lies in its light, for an owner whose light is more than one color: a Usage meter's parts, side by side. */
  lightMarkup?: Raw;
}

/**
 * A groove: a channel carved into the glass, read by its edges (a deep shade under its upper edge, a crisp lit lower lip), filled from its
 * start with orange light, light inside the glass, as far as it's filled. panes.ts's Groove shows it; a Slider's line and a Progress's track
 * are one. Its owner can set where the fill ends itself (--groove-filled-length), as a slider does, to its thumb's middle.
 */
export function groove(options: GrooveOptions = {}): Raw {
  const isRunning = options.filledPct === undefined;
  const shownPct = isRunning ? 0 : Math.max(0, Math.min(100, options.filledPct ?? 0));
  return html`<span class="groove carving deep line${options.kind ? ` ${options.kind}` : ""}${isRunning ? " is-running" : ""}" data-cut-line="3" aria-hidden="true" style="--groove-filled:${(shownPct / 100).toFixed(4)}">${CUT_LINE}<span class="groove-fill light-glow"><span class="groove-light light-fill${options.isWorking ? " light-glint loops" : ""}" data-cut-line="3" data-cut-bar>${CUT_LINE}${options.lightMarkup ?? ""}</span></span></span>`;
}

/**
 * Edge lights: pointing (with a mouse) anywhere on a holder ([data-edge-light]) wakes its whole edge (is-awake), and pointing at a part that
 * lights it ([data-lights], not the one you're on or one that can't be chosen) floods light up from the edge beside it (is-lit, at
 * --light-at, --light-span wide), gliding to the next part as you move. A part marked is-pointed (the gallery's still) keeps it lit.
 */
export const EDGE_LIGHT_SCRIPT = `/* edge light */(function () {
  function canLight(part) { return Boolean(part) && !part.matches('[aria-current="page"], [aria-pressed="true"], :disabled, [aria-disabled="true"], :has(> input:checked), :has(> input:disabled)'); }
  window.zaismaWatch.each("[data-edge-light]", function (holder) {
    var light = holder.querySelector(":scope > .edge-light");
    if (!light) return;
    var side = holder.getAttribute("data-edge-light"), isAcross = side === "bottom" || side === "top", lit = null, dimLater = null;
    // Passing over a part that doesn't light (the one you're on), the light waits a moment before it goes, so crossing it on the way to the
    // next one glides straight on instead of going out and coming back.
    var PASSING_MS = 250;
    function place(part, isGliding) {
      var h = holder.getBoundingClientRect(), r = part.getBoundingClientRect();
      // The first light comes up where it is; after that it glides along the edge to the next part.
      if (!isGliding) light.style.transition = "none";
      light.style.setProperty("--light-at", (isAcross ? r.left + r.width / 2 - h.left : r.top + r.height / 2 - h.top) + "px");
      light.style.setProperty("--light-span", (isAcross ? r.width : r.height) + "px");
      if (!isGliding) { void light.offsetWidth; light.style.transition = ""; }
    }
    function lightUp(part) { clearTimeout(dimLater); dimLater = null; place(part, holder.classList.contains("is-lit")); lit = part; holder.classList.add("is-awake", "is-lit"); }
    function dim() { clearTimeout(dimLater); dimLater = null; lit = null; holder.classList.remove("is-lit"); }
    function dimSoon() { if (!dimLater && lit) dimLater = setTimeout(dim, PASSING_MS); }
    holder.addEventListener("pointerover", function (event) {
      if (event.pointerType && event.pointerType !== "mouse") return;
      holder.classList.add("is-awake");
      var part = event.target.closest("[data-lights]");
      if (part && holder.contains(part) && canLight(part)) lightUp(part); else dimSoon();
    });
    holder.addEventListener("pointerleave", function () { dim(); holder.classList.remove("is-awake"); });
    // The keyboard's focus lights it too, where there's no ring of its own (a menu's choices, moved between with the arrow keys).
    holder.addEventListener("focusin", function (event) { var part = event.target.closest("[data-lights]"); if (part && holder.contains(part) && canLight(part) && part.matches(":focus-visible")) { holder.classList.add("is-awake"); lightUp(part); } });
    holder.addEventListener("focusout", function (event) { if (!holder.contains(event.relatedTarget)) { dim(); holder.classList.remove("is-awake"); } });
    // A part picked (the one you're on now) no longer lights; one that scrolls inside the holder keeps its light beside it.
    holder.addEventListener("click", function () { setTimeout(function () { if (lit && !canLight(lit)) dim(); }, 0); });
    holder.addEventListener("scroll", function () { if (lit) place(lit, false); }, true);
    var still = holder.matches("[data-lights].is-pointed") ? holder : holder.querySelector("[data-lights].is-pointed");
    if (still) lightUp(still);
  });
})();
`;

/* ---- The foundations in the gallery: tokens, type, glass, backdrop, cut shapes, motion and icons. ---- */

const SWATCHES: { token: string; note: string }[] = [
  { token: "--ink", note: "Words" },
  { token: "--ink-2", note: "Second words" },
  { token: "--muted", note: "Quiet words" },
  { token: "--line", note: "Lines" },
  { token: "--page", note: "Zaisma's own page" },
  { token: "--glass-tint", note: "A pane's glass" },
  { token: "--run", note: "What you act on" },
  { token: "--run-hi", note: "Its light" },
  { token: "--run-lo", note: "Its shade" },
  { token: "--tag-new", note: "A new thing's tag" },
  { token: "--warning", note: "A warning, a field marked wrong" },
  { token: "--online", note: "Online, playing" },
  { token: "--danger", note: "A delete's confirm step only" },
];

const swatches = () =>
  glassPane({ paneWidth: "full", body: stackOfOne(html`<ul class="swatches words-margin round">${SWATCHES.map(({ token, note }) => html`<li><span class="chip-swatch" data-cut-line="10" style="background:var(${token})">${CUT_LINE}</span><code class="words-margin at-end">${token}</code><span class="words-margin at-end">${note}</span></li>`)}</ul>`) });

component({
  name: "Color",
  slug: "color",
  group: "foundations",
  subgroup: "look",
  summary: "Every color comes from these tokens, so light, dark and smoked glass follow by themselves. Orange is only for what you act on, and it is always shown in full: never faded or at half opacity.",
  styles: `
/* Color: the gallery's swatches. */
/* Each swatch leads its name and use as a mark leads words, so the list keeps the words margin all round, as words do; its name on the
   swatch's top line. */
.swatches { list-style: none; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--size-figure), 1fr)); gap: var(--gap-block-block); }
.swatches li { display: grid; grid-template-columns: 2.25rem 1fr; grid-template-rows: auto auto; column-gap: var(--gap-words-words); align-items: start; font: var(--type-facts); }
/* A swatch is cut by the edge rule like everything else: square, in from the pane's corners. */
.swatches .chip-swatch { position: relative; grid-row: span 2; align-self: stretch; width: 2.25rem; min-height: 2.25rem; clip-path: var(--cut-shape); }
.swatches .chip-swatch > .cut-line polygon { stroke: var(--line); }
.swatches code { font: var(--type-code); }
/* A swatch's name and value wrap inside their own column, never over the swatch beside, however large the text. */
.swatches li > :not(.chip-swatch) { min-width: 0; overflow-wrap: anywhere; }
.swatches span:last-child { color: var(--muted); }
`,
  examples: [
    { label: "Every token", markup: swatches(), isWide: true },
  ],
});

/** The type tokens, each with what it's for and a line set in it. */
const TYPE_TOKENS: { token: string; use: string; sample: string; isMuted?: boolean }[] = [
  { token: "--type-title", use: "a game's title", sample: "Ashen Crown" },
  { token: "--type-heading", use: "a pane's heading", sample: "Welcome back" },
  { token: "--type-section", use: "a row, a section", sample: "Continue playing" },
  { token: "--type-name", use: "a name in a pane, a menu's head", sample: "emma_r" },
  { token: "--type-label", use: "a field's label, a question", sample: "When's your birthday?" },
  { token: "--type-words", use: "a line of words, an error", sample: "Liam and Sofia are playing" },
  { token: "--type-reading", use: "a paragraph to read", sample: "A fallen knight climbs a burning kingdom to take its crown back. Hard, fair fights, and a world that folds back on itself." },
  { token: "--type-note", use: "a note under something, a footer", sample: "Zaisma is open source, under the MIT license.", isMuted: true },
  { token: "--type-facts", use: "facts under a cover, a caption, a small heading", sample: "2 hours ago · 1,204 playing", isMuted: true },
  { token: "--type-tag", use: "a Tag", sample: "Updated" },
  { token: "--type-code", use: "a token or a value", sample: "version_8f3k2m" },
];

component({
  name: "Type",
  slug: "type",
  group: "foundations",
  subgroup: "look",
  summary: "Every word outside a control's own inside is set in one of these, picked by what the words are. Jost for display, the system's own face for reading; fields are 16px or more, so phones don't zoom in.",
  styles: `
/* Type: each token, set in itself. */
.type-sample { width: 100%; list-style: none; margin: 0; padding: 0; display: grid; gap: var(--gap-block-block); color: var(--ink); }
.type-sample li { display: grid; gap: var(--gap-words-words); }
.type-sample code { font: var(--type-code); color: var(--muted); }
.type-sample .is-muted { color: var(--muted); }
.type-sample p { margin: 0; max-width: 60ch; }
`,
  examples: [
    {
      label: "Every token",
      isWide: true,
      markup: html`<ul class="type-sample">${TYPE_TOKENS.map(({ token, use, sample, isMuted }) => html`<li><code class="words-margin">${token}: ${use}</code><p${isMuted ? raw(' class="is-muted"') : ""} style="font:var(${token})">${sample}</p></li>`)}</ul>`,
    },
  ],
});

/**
 * The settings every page has, in one place: what all its components follow, so one change covers every instance at once.
 * Each component's own settings sit under its name, and a page leaves out what it doesn't use. pageSettingsAttributes puts them
 * on <html> (or any element, for what's inside it, like the gallery's stage); window.zaismaSettings.set changes them in place.
 */
export interface PageSettings {
  /** Light or dark. Left out, the system's. */
  theme?: "light" | "dark";
  glass?: {
    /** Tints every piece of glass, as a #rrggbb color (like a game's color on the home). Glass tinted for a brand keeps its own color. */
    hueColor?: string;
  };
}

/** The settings as attributes for <html>. Only a #rrggbb color is taken as a hue, so a game's color can't carry anything else into the page. */
export function pageSettingsAttributes(settings: PageSettings): Raw {
  const hueColor = shownColor(settings.glass?.hueColor);
  return html`${settings.theme ? html` data-theme-choice="${settings.theme}"` : ""}${hueColor ? html` style="--glass-hue:${hueColor}"` : ""}`;
}

/** A framed backdrop with glass over it, for the Glass foundation's light examples. theme fixes light or dark inside it. */
const lightFrame = (options: { standInSlug?: string; theme?: "light" | "dark"; cards: [string, string][] }) =>
  html`<div class="backdrop-frame is-tall"${options.theme ? html` data-theme-choice="${options.theme}"` : ""}>${backdrop({ isFramed: true, standInSlug: options.standInSlug, isGlassAdaptive: Boolean(options.standInSlug) })}${options.cards.map(([title, note]) => html`<div class="glass" data-glass data-glass-corners="pane"><strong>${title}</strong><span>${note}</span></div>`)}</div>`;

const glassStrip = (body: Raw) => html`<div class="glass-strip"><i></i><i></i><i></i>${body}</div>`;

component({
  name: "Glass",
  slug: "glass",
  group: "foundations",
  subgroup: "look",
  summary: "Zaisma's interface is glass over the game or the page's backdrop, never over a plain color. It's as thin as the words allow: light with dark words, or smoked with light words.",
  styles: `
/* Glass: shown over a few shapes, so the blur has something to show, in a frame cut like a pane with the glass at its frame gap. The shapes
   sit by share of its height, so wherever the glass wraps onto more lines there's something behind each piece. */
.glass-strip { width: 100%; position: relative; display: flex; flex-wrap: wrap; gap: var(--gap-block-block); padding: var(--pad-frame); overflow: hidden; clip-path: ${cutPolygon("pane")}; }
.glass-strip > i { position: absolute; width: 140px; height: 140px; border-radius: 50%; }
.glass-strip > i:nth-child(1) { left: 6%; top: 8%; background: #F7931A; }
.glass-strip > i:nth-child(2) { left: 38%; top: 40%; width: 220px; height: 90px; border-radius: 0; transform: rotate(-12deg); background: #3B6FD0; }
.glass-strip > i:nth-child(3) { right: 8%; top: 62%; background: #1E9C8E; }
.glass-strip > .glass:not(.glass-pane) { flex: 1 1 180px; min-height: 110px; padding: var(--pad-pane); font: var(--type-words); }
.glass-strip > .glass:not(.glass-pane) strong { display: block; font: var(--type-name); }
.glass-strip .glass-kind::after { content: var(--glass-kind); }
/* Any size: one glass window over drifting shapes, to drag about and pull to any size (the gallery's script moves it).
   What's in it gives way as it shrinks, through a container query, so the glass itself never changes. */
.glass-play { position: relative; width: 100%; height: 360px; overflow: hidden; touch-action: none; background: var(--well); box-shadow: var(--well-shade);
  clip-path: ${cutPolygon("pane")}; }
.glass-play > i { position: absolute; display: block; }
.glass-play .sun { left: 8%; top: 40px; width: 150px; height: 150px; border-radius: 50%; background: #F7931A; animation: glass-drift-a 14s ease-in-out infinite alternate; }
.glass-play .bar { left: 34%; top: 150px; width: 260px; height: 70px; background: #3B6FD0; transform: rotate(-14deg); animation: glass-drift-b 18s ease-in-out infinite alternate; }
.glass-play .sea { right: 10%; top: 30px; width: 190px; height: 190px; border-radius: 50%; background: #1E9C8E; animation: glass-drift-c 16s ease-in-out infinite alternate; }
.glass-play .cut { right: 30%; bottom: -30px; width: 160px; height: 120px; background: #E0457B; clip-path: polygon(0 30px, 30px 0, 100% 0, 100% calc(100% - 30px), calc(100% - 30px) 100%, 0 100%); animation: glass-drift-b 20s ease-in-out infinite alternate-reverse; }
.glass-play .dot { left: 22%; bottom: 20px; width: 70px; height: 70px; border-radius: 50%; background: #F4C430; animation: glass-drift-c 12s ease-in-out infinite alternate-reverse; }
@keyframes glass-drift-a { to { transform: translate(90px, 50px); } }
@keyframes glass-drift-b { to { transform: translate(-70px, -40px) rotate(8deg); } }
@keyframes glass-drift-c { to { transform: translate(-60px, 70px); } }
.glass-window { position: absolute; left: 6%; top: 36px; width: min(320px, 80%); height: 200px; container-type: size; padding: var(--pad-pane);
  display: flex; flex-direction: column; gap: var(--gap-words-words); overflow: hidden; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
.glass-window.is-moving { cursor: grabbing; }
.glass-window:focus-visible { outline: none; }
.glass-window:focus-visible .edge .hair, .glass-window:focus-visible .edge .rim { stroke: var(--focus); stroke-width: 2; }
.glass-window strong { font: var(--type-name); }
.glass-window .glass-note { font: var(--type-note); color: var(--ink-2); }
.glass-window .glass-size { margin-top: auto; font: var(--type-code); color: var(--muted); }
.glass-window .glass-grip { position: absolute; z-index: 4; right: 0; bottom: 0; width: 30px; height: 30px; cursor: nwse-resize; color: var(--muted); }
.glass-window .glass-grip svg { position: absolute; right: 0; bottom: 0; width: 30px; height: 30px; }
@container (max-height: 120px) { .glass-window .glass-note { display: none; } }
@container (max-height: 76px) { .glass-window .glass-size { display: none; } }
@container (max-width: 150px) { .glass-window .glass-note { display: none; } .glass-window strong { font: var(--type-label); } }
@media (prefers-reduced-motion: reduce) { .glass-play > i { animation: none; } }
`,
  examples: [
    {
      label: "Any size: drag it, pull its corner, or use the arrow keys (Shift to resize)",
      isWide: true,
      markup: html`<div class="glass-play" data-glass-play><i class="sun"></i><i class="bar"></i><i class="sea"></i><i class="cut"></i><i class="dot"></i><div class="glass glass-window" data-glass data-glass-corners="pane" tabindex="0" role="group" aria-label="A glass window. Arrow keys move it; Shift and the arrow keys resize it."><strong>Glass, any size</strong><span class="glass-note">The same glass from a button to a whole window: its cuts and rim fit themselves to it.</span><span class="glass-size" aria-hidden="true"></span><span class="glass-grip" aria-hidden="true"><svg viewBox="0 0 30 30"><path d="M24 14L14 24M24 8L8 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span></div></div>`,
    },
    { label: "It bends the light behind it, light glass", isWide: true, markup: lightFrame({ theme: "light", cards: [["Glass", "What's behind it is magnified a little and bent along its cut edge, with light gathered on the lit facets."]] }) },
    { label: "Smoked glass: the same, fainter", isWide: true, markup: lightFrame({ theme: "dark", cards: [["Smoked glass", "Its edge light is fainter, as its rim is."]] }) },
    { label: "Over a busy shader: it picks light or smoked glass and a tint from what's behind, and the words keep their contrast", isWide: true, markup: lightFrame({ standInSlug: "neon-drift", cards: [["Neon Drift", "A city in the rain behind thick glass: bent, lit along the edge, and the words as clear as ever."]] }) },
    {
      label: "Thin to thick",
      isWide: true,
      markup: glassStrip(html`${[35, 55, 72].map((glassOpacityPct) => html`<div class="glass" data-glass data-glass-corners="pane" style="--glass-tint:rgba(var(--glass-base),${glassOpacityPct / 100})"><strong>${glassOpacityPct}%</strong><span class="glass-kind"></span></div>`)}`),
    },
  ],
});

export interface BackdropOptions {
  /** A page's own shader background: a mainImage function (shaders.ts). Left out, the page gets Zaisma's. */
  fragmentShader?: string;
  /** The glass over it takes light or smoked glass, and a tint, from what the shader draws behind it (a game's or a page's own background). */
  isGlassAdaptive?: boolean;
  /** The page draws its own 3D scene into the canvas on each backdrop-frame event, instead of a shader. */
  isScene?: boolean;
  /** Fills its own box (position: relative) instead of the window: for a backdrop shown inside something, like the gallery's examples. */
  isFramed?: boolean;
  /**
   * A stand-in game's background (STAND_IN_BACKGROUNDS), by its slug, instead of a fragmentShader: too long to write into a page, it
   * comes from STAND_IN_BACKGROUNDS_SCRIPT, a cached file the page loads as well.
   */
  standInSlug?: string;
}

/** What's behind the glass on a page: the first thing in the page's body or stage, under everything else. */
export function backdrop(options: BackdropOptions = {}): Raw {
  if (options.standInSlug && !STAND_IN_BACKGROUNDS.some((background) => background.slug === options.standInSlug)) throw new Error(`No stand-in background is called ${options.standInSlug}`);
  return html`<canvas class="backdrop${options.isFramed ? " is-framed" : ""}" data-backdrop="${options.isScene ? "scene" : "shader"}"${options.fragmentShader ? html` data-backdrop-shader="${options.fragmentShader}"` : ""}${options.standInSlug ? html` data-backdrop-stand-in="${options.standInSlug}"` : ""}${options.isGlassAdaptive ? raw(" data-adapts-glass") : ""} aria-hidden="true"></canvas>`;
}

/** A game's world as its placeholder, under its picture or shader frame until they arrive; nothing without one. */
export const backdropPlaceholder = (placeholderDataUrl: string | null): Raw =>
  placeholderDataUrl ? html`<div class="backdrop backdrop-placeholder" aria-hidden="true"${placeholderStyle(placeholderDataUrl)}></div>` : raw("");

/**
 * The stand-in games' backgrounds for a page that shows them (backdrop's standInSlug): each one's shader written onto its canvas, which
 * the backdrop then draws. It may run before or after the backdrop script, which leaves a stand-in canvas alone until it has its shader.
 */
export const STAND_IN_BACKGROUNDS_SCRIPT: PageScript = pageScript("stand-in-backgrounds", `/* stand-in backgrounds */(function () {
  var SHADERS = ${JSON.stringify(Object.fromEntries(STAND_IN_BACKGROUNDS.map((background) => [background.slug, background.shader])))};
  document.querySelectorAll("canvas[data-backdrop-stand-in]:not([data-backdrop-shader])").forEach(function (canvas) {
    var slug = canvas.getAttribute("data-backdrop-stand-in");
    if (!Object.prototype.hasOwnProperty.call(SHADERS, slug)) return;
    canvas.setAttribute("data-backdrop-shader", SHADERS[slug]);
    if (window.zaismaBackdrop) window.zaismaBackdrop.add(canvas);
  });
})();
`);

const backdropFrame = (layer: Raw, title = "Glass", note = "Always over something.") =>
  html`<div class="backdrop-frame">${layer}<div class="glass" data-glass data-glass-corners="pane"><strong>${title}</strong><span>${note}</span></div></div>`;

export interface GameBackgroundFrameOptions {
  /** The stand-in world it shows (STAND_IN_BACKGROUNDS in shaders.ts). */
  standInSlug: string;
  /** The game's name, on the glass over it. */
  title: string;
  /** A few words under the name: its kind of game. */
  note: string;
}

/** A game's world in a frame, a piece of glass over it naming the game: the gallery's examples and the background guide's. */
export function gameBackgroundFrame(options: GameBackgroundFrameOptions): Raw {
  return backdropFrame(backdrop({ isFramed: true, standInSlug: options.standInSlug, isGlassAdaptive: true }), options.title, options.note);
}

component({
  name: "Backdrop",
  slug: "backdrop",
  group: "foundations",
  subgroup: "backgrounds",
  summary: "Glass is never on a plain or solid color: there's always something behind it, still or moving. A game is its own backdrop; Zaisma's pages have Zaisma's own, a sheet of satin whose folds sway slowly in a soft light, or their own shader or 3D scene.",
  styles: `
/* The backdrop: a canvas under everything on the page. Its parent is isolated, so the canvas sits above the page's own color and below the rest.
   Until the shader draws (and wherever WebGL is missing) it shows a still gradient in the same colors. Its height is the largest the window
   gets (lvh), not the visible one, and on a phone or tablet it reaches a bleed past the top and the bottom as well: a browser's bars showing or hiding
   never resize or redraw it, and never uncover a strip of the page's own color, whichever of the two edges they move (a phone's browser reports
   the large window late, or short, while its bars move). */
.backdrop { --backdrop-bleed: 0px; position: fixed; inset: calc(-1 * var(--backdrop-bleed)) 0 auto 0; z-index: -1; display: block; border: 0; width: 100%; height: 100vh; height: calc(100lvh + 2 * var(--backdrop-bleed)); object-fit: cover; pointer-events: none; background: ${BACKDROP_STILL}; }
@media (pointer: coarse), (max-width: 760px) { .backdrop { --backdrop-bleed: 100px; } }
.backdrop.is-framed { --backdrop-bleed: 0px; position: absolute; inset: 0; height: 100%; }
/* A game's world: its background picture or shader as a layer over Zaisma's own, fading in once it's ready (the home's, home-script.ts). */
.backdrop.world { opacity: 0; object-fit: cover; border: 0; transition-property: opacity; transition-timing-function: ease; }
.backdrop.world.is-shown { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .backdrop.world { transition: none !important; } }
:has(> .backdrop) { isolation: isolate; }
.backdrop-frame { position: relative; width: 100%; height: 220px; display: flex; align-items: center; justify-content: center; overflow: hidden;
  clip-path: ${cutPolygon("pane")}; }
.backdrop-frame > .glass { width: min(260px, 80%); padding: var(--pad-pane); display: flex; flex-direction: column; gap: var(--gap-words-words); font: var(--type-note); color: var(--ink-2); }
/* Taller, holding a row of glass: the Glass foundation's light examples. */
.backdrop-frame.is-tall { height: 260px; gap: var(--gap-block-block); padding: var(--pad-pane); }
.backdrop-frame.is-tall .glass { flex: 1 1 0; width: auto; max-width: 320px; }

.backdrop-frame .glass strong { font: var(--type-name); color: var(--ink); }
/* Moving from one of Zaisma's pages to the next (PAGE_SWITCH_SCRIPT): the new page's panes fade in over --motion-page-switch while the
   header and the backdrop, the same on both pages, stand still. Each pane's body (its ::before, which blurs) and what's on it fade, never
   the pane, as a floating pane arrives: a pane fading as a whole blurs nothing behind it until it's in. Never a cross-document view
   transition (tokens.ts says why), so the page takes every press from its first frame. Opening a game from its cover moves on its own
   (Game background). Under reduced motion, and arriving from another site or a reload, the page simply shows. */
html.is-page-arriving main .glass:not(.glass .glass)::before, html.is-page-arriving main .glass:not(.glass .glass) > * { animation: page-arrives var(--motion-page-switch) var(--ease-standard) both; }
@keyframes page-arrives { from { opacity: 0; } }
`,
  render: backdrop,
  examples: [
    { label: "Zaisma's own: behind every page, warm gray on light and warm graphite on dark", isWide: true, markup: backdropFrame(backdrop({ isFramed: true })) },
    { label: "A page's own shader", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: CLOUDS_SHADER, isGlassAdaptive: true })) },
    { label: "A 3D scene the page draws", markup: backdropFrame(html`${backdrop({ isFramed: true, isScene: true })}`) },
  ],
});

component({
  name: "Shader background",
  slug: "shader-background",
  group: "foundations",
  subgroup: "backgrounds",
  summary: "A background written as a shader: one small function that paints each pixel from the time and the screen's size, in the form AI writes well. From a few lines for a sky to a whole city in the rain. Zaisma's runner draws it small, at most 30 frames a second, holds a still frame on a device that can't keep up. A shader drawn in the page bends the light under the glass: what's behind each pane magnified and bent as through thick glass, with light gathered along its cut edge. A game's own shader runs in a frame on the game's site, which can't redraw a bend in the frame the page scrolls in, so behind Zaisma's glass it shows as drawn, never bent.",
  styles: `
/* Shader background: each example a framed backdrop with its glass over it, and the simplest one's whole source beside it. */
/* Its lines run on sideways where the frame is narrow, fading at the side with more (data-fades-sideways), never cut off. */
.shader-code { margin: 0; width: 100%; padding: var(--pad-inner-pane); white-space: pre; font: var(--type-code); color: var(--ink-2);
  background: var(--well); box-shadow: var(--well-shade); }
`,
  examples: [
    { label: "Simple: a dusk sky whose horizon breathes", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: DUSK_SHADER, isGlassAdaptive: true }), "Dusk", "Four lines.") },
    { label: "Simple, with noise: clouds drifting", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: CLOUDS_SHADER, isGlassAdaptive: true }), "Clouds", "fbm, from the helpers.") },
    { label: "The dusk sky's whole source", markup: html`<pre class="shader-code" data-fades-sideways>${DUSK_SHADER.trim()}</pre>`, isWide: true },
    { label: "Complex: a whole city in the rain, as a game's own (Game background has more)", markup: backdropFrame(backdrop({ isFramed: true, standInSlug: "neon-drift", isGlassAdaptive: true }), "Neon Drift", "Skyway, neon city, rain.") },
  ],
});

component({
  name: "Game background",
  slug: "game-background",
  group: "foundations",
  subgroup: "backgrounds",
  summary: "A game's own world behind the glass, on its page and behind it on the home: a picture or a shader its developer sends, for wide screens and phones. It's the game's art, never restyled to Zaisma's look, and the glass over it turns light or smoked to keep the words clear. Until real games bring theirs, the stand-in games have these.",
  styles: `
/* Opening a game from its cover (PAGE_SWITCH_SCRIPT): the cover sinks under the press, the game's world settles in from a touch larger,
   and once it has, the page's panes fade in over it as every page's do (page-arrives, Backdrop), only later and slower. */
html.is-opening-game .backdrop { animation: opening-game-settles calc(var(--motion-page-switch) * 1.8) var(--ease-glide) both; }
@keyframes opening-game-settles { from { scale: 1.06; } }
html.is-opening-game main .glass:not(.glass .glass)::before, html.is-opening-game main .glass:not(.glass .glass) > * {
  animation-duration: calc(var(--motion-page-switch) * 0.8); animation-delay: var(--motion-page-switch); animation-timing-function: var(--ease-glide); }
/* A page prepared ahead holds its arrival, from its first frame, until it's opened (is-page-held). */
html.is-page-held .backdrop, html.is-page-held main .glass:not(.glass .glass)::before, html.is-page-held main .glass:not(.glass .glass) > * { animation-play-state: paused; }
`,
  render: gameBackgroundFrame,
  examples: STAND_IN_BACKGROUNDS.map((background) => ({
    label: `${background.genre}: ${background.summary}`,
    markup: gameBackgroundFrame({ standInSlug: background.slug, title: background.title, note: background.genre }),
  })),
});

/**
 * Moving from one of Zaisma's pages to the next (Backdrop's and Game background's motion): a page reached from another of Zaisma's by a
 * link (not a reload, not back or forward) has its panes fade in (is-page-arriving); one reached by a tap on a game's cover, the tap
 * remembered for the tab, has its world settle in first (is-opening-game). A page prepared ahead holds both from its first frame until
 * it's opened (is-page-held), and only then reads the tap, which came after it was prepared. In the first-paint script, so the classes
 * are there before the page shows.
 */
export const PAGE_SWITCH_SCRIPT = `/* page switch */(function () {
  var KEY = "zaisma:opening-game", root = document.documentElement;
  function gameSlugOf(address) {
    try { var to = new URL(address, location.href), found = to.origin === location.origin && to.pathname.match(/^\\/g\\/([^/]+)$/); return found ? found[1] : null; } catch (error) { return null; }
  }
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[href]"), slug = link && gameSlugOf(link.href);
    try { sessionStorage.removeItem(KEY); } catch (error) {}
    if (!slug || !link.querySelector(".picture, img") || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (link.target && link.target !== "_self") || slug === gameSlugOf(location.href)) return;
    try { sessionStorage.setItem(KEY, JSON.stringify({ slug: slug, pressed_at_ms: Date.now() })); } catch (error) {}
  });
  var entry = performance.getEntriesByType && performance.getEntriesByType("navigation")[0], isFromHere = false;
  try { isFromHere = new URL(document.referrer).origin === location.origin; } catch (error) {}
  if (!isFromHere || !entry || entry.type !== "navigate" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  function arrive() {
    var opening = null;
    try { opening = JSON.parse(sessionStorage.getItem(KEY) || "null"); sessionStorage.removeItem(KEY); } catch (error) {}
    if (opening && opening.slug === gameSlugOf(location.href) && Date.now() - opening.pressed_at_ms < 10000) root.classList.add("is-opening-game");
    root.classList.remove("is-page-held");
    setTimeout(function () { root.classList.remove("is-page-arriving", "is-opening-game"); }, 1500);
  }
  root.classList.add("is-page-arriving");
  if (document.prerendering) { root.classList.add("is-page-held"); document.addEventListener("prerenderingchange", arrive, { once: true }); }
  else arrive();
})();
`;

/**
 * A picture a page shows: a game's cover, screenshot or background, never a bare address. Every picture comes with its size and its
 * placeholder, the tiny copy Zaisma made of it (placeholders.ts), so the page holds its place and shows it blurred from the first paint,
 * before a byte of the picture arrives ("A page shows whole while it loads", docs/DESIGN.md).
 */
export interface ShownPicture {
  /** Where it's served: /img/<id> (then its kept sizes are offered too, SIZED_IMAGE_WIDTHS_PX), or any other address as it is. */
  imageUrl: string;
  widthPx: number;
  heightPx: number;
  /** The tiny copy as a data: URL (placeholder_data_url), or null where none was made: the picture's place then shows what's under it. */
  placeholderDataUrl: string | null;
}

export interface PictureOptions {
  /** What a screen reader says for it; left out, it's decoration (alt=""), as a card's cover is beside its title. */
  label?: string;
  /** The widths it's shown at, for the browser to pick a kept size (an img's sizes): "(max-width: 760px) 200px, 260px". */
  shownSizes?: string;
  /** The largest kept size to offer: a cover's 260px at three times its pixels by default. */
  largestPx?: number;
  /** Loads with the page, not once it nears the screen: for the pictures a page opens with in view. */
  isEager?: boolean;
  /** Fetched before the page's other pictures: for the one likely the largest thing in the first view. */
  hasHighPriority?: boolean;
  /** Holds its own box at the picture's shape (a screenshot shown large), instead of filling the well it's set in. */
  hasOwnShape?: boolean;
  /** More classes for its box: the piece it's part of ("screenshot-large"). */
  className?: string;
}

/** The largest width a picture is offered at by default: a 260px cover at three times its pixels, rounded up to a kept size. */
const PICTURE_LARGEST_PX = 960;

/** A picture Zaisma serves (/img/<id>) at the sizes it keeps of it, for the browser to pick the one it shows; any other address as it is. */
function keptSizes(imageUrl: string, shownSizes: string, largestPx: number): Raw {
  if (!/^(https?:\/\/[^/]+)?\/img\/[A-Za-z0-9_-]+$/.test(imageUrl)) return raw("");
  const widths = SIZED_IMAGE_WIDTHS_PX.filter((widthPx) => widthPx <= largestPx);
  return html` srcset="${widths.map((widthPx) => `${imageUrl}/w${widthPx}.webp ${widthPx}w`).join(", ")}" sizes="${shownSizes}"`;
}

/** The style that carries a picture's placeholder (and its shape) to its box. Only a data: URL of an image is ever written into it. */
export function placeholderStyle(placeholderDataUrl: string | null, shape?: { widthPx: number; heightPx: number }): Raw {
  const parts = [
    placeholderDataUrl && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(placeholderDataUrl) ? `--placeholder: url(${placeholderDataUrl})` : "",
    shape ? `--picture-shape: ${Math.round(shape.widthPx)} / ${Math.round(shape.heightPx)}` : "",
  ].filter(Boolean);
  return parts.length ? html` style="${parts.join("; ")}"` : raw("");
}

/**
 * A picture: its placeholder, blurred, in its place from the first paint, and the picture itself fading in over it once it has wholly
 * arrived and decoded (PICTURE_SCRIPT), never half-drawn. In a carving's well it fills the well; hasOwnShape keeps a box of its own at the
 * picture's shape. Every component that shows a picture shows it with this.
 */
export function picture(shown: ShownPicture, options: PictureOptions = {}): Raw {
  const className = ["picture", options.hasOwnShape ? "has-own-shape" : "", options.className ?? ""].filter(Boolean).join(" ");
  const sizes = keptSizes(shown.imageUrl, options.shownSizes ?? "(max-width: 760px) 200px, 260px", options.largestPx ?? PICTURE_LARGEST_PX);
  return html`<span class="${className}"${placeholderStyle(shown.placeholderDataUrl, options.hasOwnShape ? shown : undefined)}><img class="reveals" src="${shown.imageUrl}"${sizes} width="${Math.round(shown.widthPx)}" height="${Math.round(shown.heightPx)}" alt="${options.label ?? ""}" loading="${options.isEager ? "eager" : "lazy"}"${options.hasHighPriority ? raw(' fetchpriority="high"') : ""} decoding="async"></span>`;
}

/**
 * Pictures arriving: each img.reveals shows once it has wholly arrived and decoded, fading in over its placeholder; one already there when
 * this runs (from the browser's cache) shows at once. One that fails stays its placeholder. Part of the first paint's script (html.ts), so
 * a picture never waits on the rest of the page's scripts.
 */
export const PICTURE_SCRIPT = `/* pictures */(function () {
  function show(img, isAtOnce) { if (isAtOnce) img.classList.add("at-once"); img.classList.add("is-shown"); }
  window.zaismaWatch.each("img.reveals", function (img) {
    if (img.complete && img.naturalWidth) { show(img, true); return; }
    img.addEventListener("load", function () { (img.decode ? img.decode() : Promise.resolve()).then(function () { show(img, false); }, function () { show(img, false); }); });
  });
})();
`;

const pictureSample = (cover: ShownPicture, isArrived: boolean) =>
  html`<div class="carving holds-art picture-sample" data-cut-line="0">${CUT_LINE}<span class="carving-art" data-cut-line="0">${isArrived ? picture(cover) : html`<span class="picture"${placeholderStyle(cover.placeholderDataUrl)}></span>`}</span></div>`;

component({
  name: "Picture",
  slug: "picture",
  group: "foundations",
  subgroup: "pictures",
  summary: "Every picture a page shows, a cover, a screenshot or a game's background: in its place from the first moment as a tiny blurred copy of itself, sharpening in as it arrives. Nothing on a page is ever an empty box waiting for a picture.",
  styles: `
/* A picture (its box and the placeholder under it are a material: materials.ts, Pictures): in a carving's well it fills the well;
   .has-own-shape keeps the picture's own shape (--picture-shape). */
.carving-art > .picture { position: absolute; inset: 0; }
.picture.has-own-shape { aspect-ratio: var(--picture-shape); }
.picture-sample { display: block; position: relative; width: 260px; aspect-ratio: 16 / 9; }
`,
  render: picture,
  examples: [
    { label: "Before it arrives: its placeholder, blurred, in its place", isStill: true, markup: pictureSample(STAND_IN_COVER_PICTURES["neon-drift"]!, false) },
    { label: "Arrived: the picture over it", markup: pictureSample(STAND_IN_COVER_PICTURES["neon-drift"]!, true) },
    { label: "Another before it arrives", isStill: true, markup: pictureSample(STAND_IN_COVER_PICTURES["hollow-tide"]!, false) },
  ],
});

component({
  name: "Icons",
  slug: "icons",
  group: "foundations",
  subgroup: "pictures",
  summary: "Thin line icons in the words' color, so a kind of fact can be found without reading. Never decoration.",
  styles: `
/* Icons: the set, with names. */
.icon-set { width: 100%; list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--gap-block-block); color: var(--ink); }
/* A name wraps rather than widen its column: at large text, the longest names would push the set past the page. */
.icon-set li { display: flex; align-items: center; gap: var(--gap-words-words); min-width: 0; font: var(--type-facts); color: var(--ink-2); }
.icon-set li span { min-width: 0; overflow-wrap: anywhere; }
.icon-set .ico { width: 20px; height: 20px; color: var(--ink); }
.icon-set .play { width: 20px; height: 20px; color: var(--ink); }
/* Large, a pane's key icon: twice and more a line icon's size, with room above and below it, so it reads as the pane's mark. */
.large-icon { display: flex; justify-content: center; padding-block: var(--gap-block-block); color: var(--ink-2); }
.large-icon > .ico { width: 48px; height: 48px; stroke-width: 1.3; }
`,
  render: icon,
  examples: [
    { label: "Every icon", isWide: true, markup: html`<ul class="icon-set">${Object.keys(ICONS).map((name) => html`<li>${icon(name as IconName)}<span>${name}</span></li>`)}</ul>` },
    { label: "Large: a pane's key icon, standing for what it is, above its title (Confirm it's you)", markup: html`${largeIcon("key")}` },
  ],
});

component({
  name: "Logo",
  slug: "logo",
  group: "foundations",
  subgroup: "pictures",
  summary: "Zaisma's logo, always a link home: the wordmark at the top of a page, the mark alone in the footer. Julius's Z in glass, black on light glass and white on smoked, never orange and never restyled.",
  styles: `
/* The logo: the glass drawing for the glass it's on, its glass --logo-height tall (a bar sets it as it slims). Each file has room round the
   glass for its shadow (--logo-file-share: the file's height over the glass's, from scripts/brand.mjs), which falls outside the logo's box. */
.logo { display: flex; align-items: center; flex: none; padding: 6px 2px; }
.logo .on-light { display: var(--on-light); }
.logo .on-smoked { display: var(--on-smoked); }
.logo.wordmark { --logo-height: 26px; --logo-file-share: 1.1608; }
.logo.mark { --logo-height: 17px; --logo-file-share: 1.2047; padding: 0; }
.logo > .logo-art { height: calc(var(--logo-height) * var(--logo-file-share)); width: auto; background: center / contain no-repeat; margin-block: calc(var(--logo-height) * (1 - var(--logo-file-share)) / 2); transition: height var(--motion-glide) var(--ease-glide), margin var(--motion-glide) var(--ease-glide); }
.logo:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
/* On a touch screen it's a control's height to press, whatever its size. */
@media (pointer: coarse) { .logo { position: relative; } .logo::before { content: ""; position: absolute; inset: min(0px, calc((var(--touch-target) - 100%) / -2)) 0; } }
@media (prefers-reduced-motion: reduce) { .logo > .logo-art { transition: none; } }
${LOGO_STYLES}
`,
  render: logo,
  examples: [
    { label: "The wordmark on light glass: black glass", markup: logoOn("light", logo("wordmark")) },
    { label: "The wordmark on smoked glass: white glass", markup: logoOn("smoked", logo("wordmark")) },
    { label: "The mark on light glass", markup: logoOn("light", logo("mark")) },
    { label: "The mark on smoked glass", markup: logoOn("smoked", logo("mark")) },
  ],
});

