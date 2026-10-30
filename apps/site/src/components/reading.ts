import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { secondaryButton, textLink } from "./actions.ts";
import { CUT_LINE, glassPane, groove, icon, tag } from "./foundations.ts";
import type { IconName } from "./icons.ts";
import { row, stack } from "./layout.ts";

/*
 * Words and the ways through them that pages still to build need: Reading text (a forum post, the rules, a game's description), Facts (what
 * something is, label by label), Breadcrumbs (where a page sits), a Folded part (what's there but out of the way), a Pager (newer and older
 * pages of a list), a Divider with words (or), and Progress (a task on its way, like an upload).
 */

export interface ReadingTextOptions {
  /**
   * What it says, made safe already (Markdown the site rendered): paragraphs, headings (h2, h3), lists, quotes, code, tables and pictures. A
   * link in it is a Link (class "link"), as everywhere.
   */
  markup: Raw;
  label?: string;
}

/** Reading text: words to read, in the system's own face, each line at most a reading width long, spaced by what's on each side. */
export function readingText(options: ReadingTextOptions): Raw {
  return html`<div class="reading"${options.label ? html` role="region" aria-label="${options.label}"` : ""}>${options.markup}</div>`;
}

export interface Fact {
  /** What the fact is about, in a few words: Players, Works on, Released. */
  label: string;
  /** The fact itself, in words: Linux, Oct 14, 2026. */
  text?: string;
  /** Or its entries, each with the icon that says it at a glance (Single-player, Online co-op). */
  entries?: { text: string; icon: IconName }[];
}

export interface FactsOptions {
  facts: Fact[];
  /** "across": side by side while they fit, each a quiet label over its words (a game's players and devices). "down": one a line, the
   *  label beside its words, the labels in one column (a version's details, a key's). */
  arrangement: "across" | "down";
  label?: string;
}

/** Facts: what something is, in a few short facts, each a quiet label with its words. */
export function facts(options: FactsOptions): Raw {
  return html`<dl class="facts ${options.arrangement}"${options.label ? html` aria-label="${options.label}"` : ""}>${options.facts.map(
    (fact) => html`<div class="fact"><dt>${fact.label}</dt><dd>${fact.entries ? fact.entries.map((entry) => html`<span class="fact-entry">${icon(entry.icon)}<span>${entry.text}</span></span>`) : fact.text ?? ""}</dd></div>`,
  )}</dl>`;
}

export interface BreadcrumbsOptions {
  /** The pages above this one, from the top: Forum, Rooms. */
  trail: { label: string; href: string }[];
  /** This page's own name, said last. */
  current: string;
}

/** Breadcrumbs: where a page sits, the pages above it as quiet Links with a chevron between, this one last in words. On a phone it scrolls sideways, fading at the edge with more. */
export function breadcrumbs(options: BreadcrumbsOptions): Raw {
  const chevron = html`<span class="crumb-chevron" aria-hidden="true">${icon("chevron-right")}</span>`;
  return html`<nav class="breadcrumbs" aria-label="Where this page is"><ol data-fades-sideways>${options.trail.map((step) => html`<li>${textLink(step.label, step.href, { isQuiet: true })}${chevron}</li>`)}<li><span aria-current="page">${options.current}</span></li></ol></nav>`;
}

export interface FoldedPartOptions {
  /** What's folded away, as its heading: Earlier, Blocked, Preview links. */
  title: string;
  /** How many things are in it, said beside the title: Blocked (3). */
  entryCount?: number;
  body: Raw;
  isOpen?: boolean;
  id?: string;
}

/**
 * A folded part: something that belongs on the page but out of the way (earlier versions, blocked people), behind its title and how many are
 * in it. Pressing the title opens it in place; it works without a script (a details element).
 */
export function foldedPart(options: FoldedPartOptions): Raw {
  return html`<details class="folded"${options.id ? html` id="${options.id}"` : ""}${options.isOpen ? raw(" open") : ""}><summary class="folded-head flush-row quiet" data-cut-line="8">${CUT_LINE}<span class="folded-chevron" aria-hidden="true">${icon("chevron-right")}</span><span>${options.title}</span>${options.entryCount !== undefined ? tag(options.entryCount, "count") : ""}</summary><div class="folded-body">${options.body}</div></details>`;
}

export interface FoldRow {
  /** Unique on the page: the row's anchor, so a link to #<id> lands on it open (FOLD_ROWS_SCRIPT). */
  id: string;
  /** What the row is, in a few words: Sexual content, Real people. */
  title: string;
  /** Its one line, always shown beside the title: a rule's test. */
  detail: string;
  /** What folds open under it. */
  body: Raw;
}

export interface FoldRowsOptions {
  rows: FoldRow[];
  label?: string;
}

/**
 * Fold rows: things to scan by their title and one line, each opening in place to what's under it (a rule's Fine and Not fine), with
 * hairlines between. A row is a details element, so it opens without a script; a link to its anchor opens it too (FOLD_ROWS_SCRIPT).
 */
export function foldRows(options: FoldRowsOptions): Raw {
  return html`<div class="fold-rows hairlines"${options.label ? html` role="group" aria-label="${options.label}"` : ""}>${options.rows.map(
    (foldRow) => html`<details class="fold-row" id="${foldRow.id}"><summary class="fold-row-head flush-row quiet" data-cut-line="8">${CUT_LINE}<span class="fold-row-title">${foldRow.title}</span><span class="fold-row-detail">${foldRow.detail}</span><span class="fold-row-chevron" aria-hidden="true">${icon("chevron-right")}</span></summary><div class="fold-row-body words-margin">${foldRow.body}</div></details>`,
  )}</div>`;
}

/** Opens the fold row a link points at (#<id>), on arrival and when the address's anchor changes. */
export const FOLD_ROWS_SCRIPT = `
(() => {
  const openTarget = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const foldRow = id ? document.getElementById(id) : null;
    if (foldRow && foldRow.matches("details.fold-row")) foldRow.open = true;
  };
  openTarget();
  addEventListener("hashchange", openTarget);
})();
`;

export interface PagerOptions {
  /** What's paged, for a screen reader: Replies, Versions. */
  label: string;
  /** The newer page, where there is one. */
  newerHref?: string;
  /** The older page, where there is one. */
  olderHref?: string;
}

/** A pager: Newer and Older under a list that's read page by page (a topic's replies); the end you're at can't be pressed. A list you add to in place has Load more instead. */
export function pager(options: PagerOptions): Raw {
  return html`<nav class="pager" aria-label="${options.label}: pages">${row({
    widths: "equal",
    items: [
      { kind: "control", markup: secondaryButton("Newer", options.newerHref ? { href: options.newerHref, icon: "arrow-back" } : { type: "button", icon: "arrow-back", isDisabled: true }) },
      { kind: "control", markup: secondaryButton("Older", options.olderHref ? { href: options.olderHref, icon: "arrow-on" } : { type: "button", icon: "arrow-on", isDisabled: true }) },
    ],
  })}</nav>`;
}

/** A divider with words: a hairline across a pane with a word or two in its middle, between two ways to do one thing (or). */
export function dividerWords(words: string): Raw {
  return html`<p class="divider-words words-margin"><span class="hairline"></span><span>${words}</span><span class="hairline"></span></p>`;
}

export interface ProgressOptions {
  /** What's on its way: Uploading Ashen Crown. */
  label: string;
  /** How much is done, and of how much, in the unit: 12 of 48 MB. Left out, it's on its way with no end known yet. */
  doneNumber?: number;
  totalNumber?: number;
  /** What the numbers count: MB, files. */
  unit?: string;
}

/** Progress: a task on its way that takes a while (an upload, a scan): a Groove filling with orange light as it goes, and how much is done in words. With no end known yet, a light runs along it. */
export function progress(options: ProgressOptions): Raw {
  const isKnown = options.doneNumber !== undefined && options.totalNumber !== undefined && options.totalNumber > 0;
  const donePct = isKnown ? Math.max(0, Math.min(100, (options.doneNumber! / options.totalNumber!) * 100)) : 0;
  const amount = isKnown ? `${options.doneNumber!.toLocaleString("en-US")} of ${options.totalNumber!.toLocaleString("en-US")}${options.unit ? ` ${options.unit}` : ""}` : "";
  return html`<div class="progress${isKnown ? "" : " is-unknown"}" role="progressbar" aria-label="${options.label}"${isKnown ? html` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${String(Math.round(donePct))}" aria-valuetext="${amount}"` : ""}><div class="progress-words words-margin"><span>${options.label}</span>${amount ? html`<span class="progress-amount">${amount}</span>` : ""}</div>${groove({ filledPct: isKnown ? donePct : undefined, isWorking: isKnown && donePct < 100 })}</div>`;
}

component({
  name: "Reading text",
  slug: "reading-text",
  group: "data",
  subgroup: "reading",
  summary: "Words to read: a forum post, the rules, a game's description, its patch notes. Paragraphs in the system's own face, each line at most a reading width long, with headings, lists, quotes, code and tables spaced by what's on each side.",
  styles: `
/* Reading text: paragraphs in the reading face, lines at most a reading width; a block's gap between paragraphs and anything else, a word's
   gap between a heading and what it heads, and between a list's lines. Code sits in a carved well reaching out to the frame gap, its lines
   in line with the words and wrapping rather than cut off; a quote is set in from a hairline. */
.reading { min-width: 0; max-width: var(--size-reading); font: var(--type-reading); color: var(--ink-2); overflow-wrap: break-word; }
.reading > * { margin: 0; }
/* As a pane's own headings are, its margins are set with a selector a pane's heading rule can't outweigh. */
.reading > :nth-child(n + 2) { margin-top: var(--gap-block-block); }
.reading > :is(h2, h3) + :nth-child(n + 2) { margin-top: var(--gap-words-words); }
.reading h2 { font: var(--type-section); color: var(--ink); }
.reading h3 { font: var(--type-name); color: var(--ink); }
.reading :is(ul, ol) { padding-inline-start: var(--gap-block-block); display: grid; gap: var(--gap-words-words); }
.reading li::marker { color: var(--muted); }
.reading strong { font-weight: 600; color: var(--ink); }
.reading :not(pre) > code { font: var(--type-code); color: var(--ink); background: var(--well); padding: 0 4px; }
.reading pre { margin-inline: calc(-1 * var(--pad-inside-words)); padding: var(--pad-inside-words); font: var(--type-code); color: var(--ink); background: var(--well); box-shadow: var(--well-shade);
  white-space: pre-wrap; overflow-wrap: anywhere; }
.reading blockquote { padding-inline-start: var(--gap-words-control); border-inline-start: var(--divider); color: var(--muted); }
.reading table { border-collapse: collapse; font: var(--type-words); }
.reading :is(th, td) { padding: var(--gap-words-words) var(--gap-words-control); border-bottom: var(--divider); text-align: start; }
.reading th { font: var(--type-facts); color: var(--muted); }
.reading img { display: block; max-width: 100%; height: auto; }
`,
  render: readingText,
  examples: [
    {
      label: "A game's description, with its patch notes",
      isWide: true,
      markup: glassPane({
        paneWidth: "full",
        // Reading text is words: in a pane it keeps the pane's margin, as a stack's words item.
        body: stack({ items: [{ kind: "words", markup: readingText({
          markup: html`<p>A fallen knight climbs a burning kingdom to take its crown back. Hard, fair fights, and a world that folds back on itself: every shortcut you open stays open.</p><h2>Version 14</h2><ul><li>Rooms past 50 players stay connected.</li><li>The Ember Gate boss waits for everyone in the room before it wakes.</li><li>Saves made on a phone open on a computer, and the other way round.</li></ul><blockquote>The old Ember Gate save points still work, so nobody loses a run.</blockquote><p>Run it on your own server with <code>npx @zaisma/game-server</code>, or upload a build:</p><pre>npx @zaisma/cli upload ./build --game ashen-crown</pre><p>Read more on ${textLink("the forum", "#reading-text")}.</p>`,
        }) }] }),
      }),
    },
  ],
});

component({
  name: "Facts",
  slug: "facts",
  group: "data",
  subgroup: "lists",
  summary: "What something is, in a few short facts, each a quiet label with its words: who a game is for and what it runs on (side by side), or a version's or a key's details (one a line).",
  styles: `
/* Facts: a quiet label (facts) with its words (a line's). Across: side by side while they fit, each label over its words. Down: one a line,
   the labels in a column of their own, as wide as the longest. */
.facts { margin: 0; min-width: 0; }
/* In a pane as wide as what's in it, facts wrap rather than widen it past a card and a half: a game's pane stays compact however many ways it's
   played. Narrower than that where the pane has less room, they wrap inside their margin, never into it. */
.glass-pane.fit .facts { max-width: calc(1.5 * var(--size-card)); }
.facts.across { display: flex; flex-wrap: wrap; gap: var(--gap-words-control) var(--gap-block-block); }
.facts.across > .fact { display: grid; gap: var(--gap-words-words); min-width: 0; }
.facts.down { display: grid; grid-template-columns: fit-content(40%) minmax(0, 1fr); align-items: baseline; gap: var(--gap-words-words) var(--gap-block-block); }
.facts.down > .fact { display: contents; }
.fact dt { font: var(--type-facts); color: var(--muted); }
.facts.down .fact dt, .facts.down .fact dd { min-width: 0; }
.fact dd { margin: 0; display: flex; flex-wrap: wrap; gap: var(--gap-words-words) var(--gap-words-control); font: var(--type-words); color: var(--ink); overflow-wrap: anywhere; }
/* An entry: its line icon, quiet, then its words. */
.fact-entry { display: inline-flex; align-items: center; gap: var(--gap-words-words); white-space: nowrap; }
.fact-entry > .ico { color: var(--muted); }
`,
  render: facts,
  examples: [
    {
      label: "Across: a game's players and devices",
      isWide: true,
      markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: facts({ arrangement: "across", label: "About this game", facts: [{ label: "Players", entries: [{ text: "Single-player", icon: "person" }, { text: "Online co-op", icon: "globe" }] }, { label: "Works on", entries: [{ text: "Computer", icon: "computer" }, { text: "Tablet", icon: "tablet" }] }] }) }] }) }),
    },
    {
      label: "Down: a version's details",
      markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: facts({ arrangement: "down", label: "Version 14", facts: [{ label: "Status", text: "Live since Oct\u00a014, 2026" }, { label: "Files", text: "312 files, 48 MB" }, { label: "Scanned", text: "Passed in 41 seconds" }, { label: "Uploaded by", text: "the_longest_username_allowed with Zaisma CLI 1.4" }] }) }] }) }),
    },
  ],
});

component({
  name: "Breadcrumbs",
  slug: "breadcrumbs",
  group: "navigation",
  subgroup: "places",
  summary: "Where a page sits: the pages above it as quiet links, a chevron between, this one last. For pages a few levels deep, like a forum topic or a game's version. On a phone it scrolls sideways rather than wrapping.",
  styles: `
/* Breadcrumbs: quiet links in notes, a small chevron between, the page you're on last in ink. One line: on a narrow screen it scrolls
   sideways, fading at the edge with more. Each link's hit area is a control's height on a touch screen. */
.breadcrumbs { min-width: 0; font: var(--type-note); }
.breadcrumbs ol { list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: var(--gap-words-words); white-space: nowrap; }
.breadcrumbs li { display: flex; align-items: center; gap: var(--gap-words-words); flex: none; }
.breadcrumbs .link { position: relative; color: var(--ink-2); }
.breadcrumbs [aria-current] { color: var(--ink); font-weight: 600; }
.crumb-chevron { display: flex; color: var(--muted); }
.crumb-chevron > .ico { width: 7px; height: 11px; }
@media (pointer: coarse) { .breadcrumbs .link::before { content: ""; position: absolute; inset: calc((var(--touch-target) - 1lh) / -2) 0; } }
`,
  render: breadcrumbs,
  examples: [
    { label: "A forum topic, at the top of its pane", isWide: true, markup: glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "words", markup: breadcrumbs({ trail: [{ label: "Forum", href: "#breadcrumbs" }, { label: "Rooms", href: "#breadcrumbs" }], current: "Rooms drop everyone at 50 players" }) }] }) }) },
    { label: "A game's version, in a pane", isWide: true, markup: glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "words", markup: breadcrumbs({ trail: [{ label: "Your games", href: "#breadcrumbs" }, { label: "Ashen Crown", href: "#breadcrumbs" }, { label: "Versions", href: "#breadcrumbs" }], current: "Version 14" }) }, { kind: "words", markup: html`<h2>Version 14</h2>` }] }) }) },
  ],
});

component({
  name: "Folded part",
  slug: "folded-part",
  group: "panes",
  subgroup: "glass",
  summary: "Something that belongs on the page but out of the way, behind its title and how many are in it: earlier versions, blocked people, preview links. Pressing the title opens it in place. Not for what the player came to the page for, which stays open; for a list to scan by its titles, Fold rows.",
  styles: `
/* A folded part: its title a pressable line of words with a chevron that turns as it opens, and its count's Tag; what's in it under the title,
   a block's gap below. The title keeps the pane's margin like words, and is a control's height to press. */
.folded { min-width: 0; }
/* It's words, keeping the pane's margin at its edges (layout.ts's edge words), and a control's height to press. */
.folded-head { padding-block: 0; list-style: none; font: var(--type-label); }
.folded-head::-webkit-details-marker { display: none; }
/* Pointed at, its words darken and its chevron steps on, the way a tertiary button's arrow does. */
.folded-head:hover .folded-chevron { transform: translateX(2px); }
.folded[open] > .folded-head:hover .folded-chevron { transform: rotate(90deg) translateX(2px); }
.folded-chevron { display: flex; color: var(--muted); transition: transform var(--motion-arrive) var(--spring); }
.folded-chevron > .ico { width: 8px; height: 13px; }
.folded[open] > .folded-head .folded-chevron { transform: rotate(90deg); }
.folded-body { margin-top: var(--gap-block-block); }
@media (prefers-reduced-motion: reduce) { .folded-chevron { transition: none; } }
`,
  render: foldedPart,
  examples: [
    { label: "Folded, with its count", isWide: true, markup: glassPane({ paneWidth: "full", body: foldedPart({ title: "Blocked", entryCount: 3, body: html`<p>Mia, Lucas and Oliver can't see you or send you anything.</p>` }) }) },
    { label: "Open", isWide: true, markup: glassPane({ paneWidth: "full", body: foldedPart({ title: "Earlier versions", entryCount: 12, isOpen: true, body: stack({ items: [{ kind: "words", markup: html`<p>Versions 1 to 12, each kept for a year after it's replaced.</p>` }] }) }) }) },
  ],
});

component({
  name: "Fold rows",
  slug: "fold-rows",
  group: "panes",
  subgroup: "glass",
  summary: "Things to scan by a title and one line, each opening in place to what's under it, like the content rules with their tests: the title and line always show, the rest folds. A link to a row opens it. Not for one thing out of the way (a Folded part) or rows to act on (a List).",
  styles: `
/* Fold rows: one thing a row, hairlines between. The head is the title, its line beside it, and a chevron at the end that turns as it opens;
   on a narrow pane the line goes under the title. The head is words, keeping the pane's margin, and at least a control's height to press. */
.fold-rows { display: grid; min-width: 0; container-type: inline-size; }
.fold-row-head { display: grid; grid-template-columns: minmax(0, 11rem) minmax(0, 1fr) auto; align-items: baseline; gap: var(--gap-words-words) var(--gap-words-control); list-style: none; }
.fold-row-head::-webkit-details-marker { display: none; }
.fold-row-title { font: var(--type-label); color: var(--ink); overflow-wrap: anywhere; }
.fold-row-detail { font: var(--type-words); color: var(--ink-2); }
.fold-row-chevron { display: flex; align-self: center; color: var(--muted); transition: transform var(--motion-arrive) var(--spring); }
.fold-row-chevron > .ico { width: 8px; height: 13px; }
/* Pointed at, its title darkens and its chevron steps on, the way a folded part's does. */
.fold-row-head:hover .fold-row-chevron { transform: translateX(2px); }
.fold-row[open] > .fold-row-head .fold-row-chevron { transform: rotate(90deg); }
.fold-row-body { margin-bottom: var(--gap-block-block); }
/* At a pane's edge the first and last rows' words keep the pane's margin, as words do. */
.fold-row:first-child > .fold-row-head { padding-top: var(--pad-words); }
.fold-row:last-child:not([open]) > .fold-row-head { padding-bottom: var(--pad-words); }
@container (max-width: 34rem) { .fold-row-head { grid-template-columns: minmax(0, 1fr) auto; } .fold-row-detail { grid-column: 1; } .fold-row-chevron { grid-row: 1; grid-column: 2; } }
@media (prefers-reduced-motion: reduce) { .fold-row-chevron { transition: none; } }
`,
  render: foldRows,
  examples: [
    {
      label: "One open",
      isWide: true,
      markup: glassPane({
        paneWidth: "full",
        body: stack({ items: [{ kind: "block", markup: foldRows({
          rows: [
            { id: "fold-rows-sexual", title: "Sexual content", detail: "Does the game show nudity, or show or describe sex in detail?", body: facts({ arrangement: "across", facts: [{ label: "Fine", text: "Romance, kissing, dating sims, swimwear and dirty jokes." }, { label: "Not fine", text: "Nudity, or sex shown or described in detail." }] }) },
            { id: "fold-rows-chat", title: "Typed chat", detail: "Can a player type text that another player reads as written, outside room.chat?", body: facts({ arrangement: "across", facts: [{ label: "Fine", text: "A chat box that sends with room.chat, preset phrases and emotes." }, { label: "Not fine", text: "Typed messages sent with room.send." }] }) },
          ],
        }) }] }),
      }),
    },
  ],
});

component({
  name: "Pager",
  slug: "pager",
  group: "navigation",
  subgroup: "scrolling",
  summary: "Newer and Older under a list read a page at a time, like a topic's replies. The end you're at can't be pressed. A list you add to in place has Load more instead.",
  styles: `
/* A pager: Newer and Older, an equal Row. */
.pager { min-width: 0; }
`,
  render: pager,
  examples: [
    { label: "In the middle", isWide: true, markup: glassPane({ paneWidth: "full", body: pager({ label: "Replies", newerHref: "#pager", olderHref: "#pager" }) }) },
    { label: "On the newest page", isWide: true, markup: glassPane({ paneWidth: "full", body: pager({ label: "Replies", olderHref: "#pager" }) }) },
  ],
});

component({
  name: "Divider with words",
  slug: "divider-with-words",
  group: "panes",
  subgroup: "glass",
  summary: "A hairline across a pane with a word or two in its middle, between two ways to do one thing: or, between signing in with a password and with a passkey. Not between parts that aren't alternatives: the gap between them does that.",
  styles: `
/* A divider with words: a hairline each side of its words, in facts. */
.divider-words { display: flex; align-items: center; gap: var(--gap-words-words); margin: 0; font: var(--type-facts); color: var(--muted); }
`,
  render: dividerWords,
  examples: [{ label: "Between two ways in", isWide: true, markup: glassPane({ paneWidth: "full", body: dividerWords("or") }) }],
});

component({
  name: "Progress",
  slug: "progress",
  group: "data",
  subgroup: "numbers",
  summary: "A task on its way that takes a while, like an upload or a scan: a Groove filling with orange light as it goes, and how much is done in words. With no end known yet, a light runs along it.",
  styles: `
/* Progress: its words over a Groove that fills with orange light; with no end known, a light runs along it instead. */
.progress { display: grid; gap: var(--gap-words-control); min-width: 0; }
.progress-words { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 var(--gap-words-control); font: var(--type-words); color: var(--ink); }
.progress-amount { color: var(--ink-2); font-variant-numeric: tabular-nums; }
`,
  render: progress,
  examples: [
    { label: "An upload on its way", isWide: true, markup: glassPane({ paneWidth: "full", body: progress({ label: "Uploading Ashen Crown", doneNumber: 12.4, totalNumber: 48, unit: "MB" }) }) },
    { label: "No end known yet", isWide: true, markup: glassPane({ paneWidth: "full", body: progress({ label: "Scanning version 14" }) }) },
  ],
});
