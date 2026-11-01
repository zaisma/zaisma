import { html, raw, type Raw } from "../markup.ts";
import { colorCode, codeLanguageName, type CodeLanguage } from "./code-colors.ts";
import { component } from "./component.ts";
import { secondaryButton, textLink, toggleButton } from "./actions.ts";
import { CUT_LINE, divider, glassPane, groove, icon, tag, well } from "./foundations.ts";
import type { IconName } from "./icons.ts";
import { row, stack, stackOfOne } from "./layout.ts";
import { slab } from "./materials.ts";

/*
 * Words and the ways through them that pages still to build need: Reading text (a forum post, the rules, a game's description), Facts (what
 * something is, label by label), Breadcrumbs (where a page sits), a Folded part (what's there but out of the way), a Pager (newer and older
 * pages of a list), a Divider (a line between parts, or with words: or), and Progress (a task on its way, like an upload).
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
  return html`<div class="progress${isKnown ? "" : " is-unknown"}" role="progressbar" aria-label="${options.label}"${isKnown ? html` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${String(Math.round(donePct))}" aria-valuetext="${amount}"` : ""}><div class="progress-words words-margin"><span class="progress-label">${options.label}</span>${amount ? html`<span class="progress-amount">${amount}</span>` : ""}</div>${groove({ filledPct: isKnown ? donePct : undefined, isWorking: isKnown && donePct < 100 })}</div>`;
}

component({
  name: "Reading text",
  slug: "reading-text",
  group: "data",
  subgroup: "reading",
  summary: "Words to read: a forum post, the rules, a game's description, its patch notes. Paragraphs in the system's own face, each line at most a reading width long, with headings, bold, italics, struck words, links, numbered, lettered and bulleted lists, quotes, rules, code and tables, spaced by what's on each side.",
  styles: `
/* Reading text: paragraphs in the reading face, lines at most a reading width; a block's gap between paragraphs and anything else, a word's
   gap between a heading and what it heads, and between a list's lines. A block of code is a Code block (a post's Markdown renders one); bare preformatted text sits in a carved well reaching out to the
   frame gap, its lines in line with the words and wrapping rather than cut off; a quote is set in from a hairline. */
.reading { min-width: 0; max-width: var(--size-reading); font: var(--type-reading); color: var(--ink-2); overflow-wrap: break-word; }
.reading > * { margin: 0; }
/* As a pane's own headings are, its margins are set with a selector a pane's heading rule can't outweigh. */
.reading > :nth-child(n + 2) { margin-top: var(--gap-block-block); }
.reading > :is(h2, h3) + :nth-child(n + 2) { margin-top: var(--gap-words-words); }
.reading h2 { font: var(--type-section); color: var(--ink); }
.reading h3 { font: var(--type-name); color: var(--ink); }
/* A list's lines are set in from their bullets at the start, and keep the words margin at the end, as a paragraph does (tokens.ts). */
.reading :is(ul, ol) { padding-inline: var(--gap-block-block) var(--pad-words); display: grid; gap: var(--gap-words-words); }
.reading li::marker { color: var(--muted); }
/* A numbered list counts in figures of one width, set in far enough for 10 and over; a list inside it counts a, b, c, and one inside that
   i, ii, iii, as rules and terms are numbered. A bullet list inside a bullet list takes a ring. */
.reading ol { padding-inline-start: calc(var(--gap-block-block) + 1.25ch); }
.reading ol li::marker { font-variant-numeric: tabular-nums; }
.reading ol ol { list-style-type: lower-alpha; }
.reading ol ol ol { list-style-type: lower-roman; }
.reading ul ul { list-style-type: circle; }
.reading li > :is(ul, ol) { margin-top: var(--gap-words-words); padding-inline-end: 0; }
.reading strong { font-weight: 600; color: var(--ink); }
.reading em { font-style: italic; }
/* Struck words read as taken out: muted, struck through in the same muted ink. */
.reading :is(del, s) { color: var(--muted); text-decoration-color: var(--muted); }
.reading :not(pre) > code { font: var(--type-code); color: var(--ink); background: var(--well); padding: 0 4px; }
.reading > pre { margin-inline: calc(-1 * var(--pad-inside-words)); padding: var(--pad-inside-words); font: var(--type-code); color: var(--ink); background: var(--well); box-shadow: var(--well-shade);
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
    {
      label: "Every format: as a forum post or the rules would have them",
      isWide: true,
      markup: glassPane({
        paneWidth: "full",
        body: stack({ items: [{ kind: "words", markup: readingText({
          markup: html`<h2>Ashen Crown, version 15</h2><p>The Ember Gate is <strong>open to raids of up to 40 players</strong>, and <em>every</em> boss now scales to its raid. The old cap of <del>12 players</del> is gone. Set it in <code>raid.max_size</code>, or read <a href="#reading-text">how raids scale</a>.</p><h3>What changes</h3><ol><li>A raid past 12 splits its bosses into phases.<ol><li>Phase one needs every role.</li><li>Phase two opens the side gates.<ol><li>Unless the raid is under 20.</li><li>Or it chose the short path.</li></ol></li></ol></li><li>A full raid says so before you join.</li><li>Loot drops for each player, never shared.</li><li>Nothing changes for parties under 12.</li><li>Saves keep their checkpoints.</li><li>Raids keep their two-hour clock.</li><li>Watchers don't count toward the cap.</li><li>Voice keeps to the 16 players nearest you.</li><li>The Ember Gate boss waits for every player.</li><li>Logs show which phase you died in.</li></ol><ul><li>Works with every controller.<ul><li>Gamepads, keyboards and touch.</li></ul></li><li>No new download.</li></ul><blockquote><p>Forty of us on one boss finally works. Best night we have had in this game.</p></blockquote><hr>${codeBlock({ code: 'raid.start({ gate: "ember", max_size: 40 }); // two phases past 12 players', codeLanguage: "javascript" })}<table><thead><tr><th>Raid size</th><th>Boss phases</th></tr></thead><tbody><tr><td>Up to 12</td><td>One</td></tr><tr><td>13 to 40</td><td>Two</td></tr></tbody></table>`,
        }) }] }),
      }),
    },
  ],
});

export interface CodeBlockOptions {
  code: string;
  /** Its language, which colors it and names it in its head. Left out, it's one color, its head saying "Code". */
  codeLanguage?: CodeLanguage;
  /** The gallery's fixed state: wrapped (Wrap on), or just copied. */
  state?: "is-wrapped" | "is-copied";
}

/**
 * A code block: code to read, copy or run, in a carved well, its language and its colors (keywords, strings, numbers and comments, colored
 * on the server). Its head is a dense slab across the well's top, as a table's header is: the language, "Copied" for a moment after Copy,
 * then Wrap and Copy. Its lines keep their length and scroll sideways on Zaisma's rail; Wrap folds them to the width instead, and shows
 * only while a line is too long to show whole.
 */
export function codeBlock(options: CodeBlockOptions): Raw {
  const isWrapped = options.state === "is-wrapped", isCopied = options.state === "is-copied";
  const head = html`<div class="code-head"><span class="code-language">${options.codeLanguage ? codeLanguageName(options.codeLanguage) : "Code"}</span><span class="code-said" role="status">${isCopied ? "Copied" : ""}</span>${row({ widths: "fit", items: [{ kind: "control", markup: toggleButton("Wrap", { type: "button", isSmall: true, isPressed: isWrapped, dataAttributes: { "code-wrap": "" } }) }, { kind: "control", markup: secondaryButton("Copy", { type: "button", isSmall: true, icon: "copy", dataAttributes: { "code-copy": "" } }) }] })}</div>`;
  return html`<figure class="code-block${isWrapped ? " is-wrapped" : ""}${isCopied ? " is-copied" : ""}">${well({
    kind: "code-well",
    body: html`${slab({ body: raw(""), isDense: true, kind: "code-head-slab" })}${head}<div class="code-scroll" data-fades-sideways data-side-rail><pre class="code-lines"><code>${raw(colorCode(options.code, options.codeLanguage))}</code></pre></div>`,
  })}</figure>`;
}

/**
 * Code blocks: Copy puts the code on the clipboard and says "Copied" for a moment; Wrap folds the lines to the width, and unfolds them.
 * Wrap shows only while a line is longer than the block shows (or while it's on), so it never sits there doing nothing.
 */
export const CODE_BLOCK_SCRIPT = `/* code blocks */(function () {
  function fit(block) {
    var wrap = block.querySelector("[data-code-wrap]"), box = block.querySelector(".code-scroll"), code = block.querySelector(".code-lines");
    if (!wrap || !box || !code) return;
    wrap.hidden = !block.classList.contains("is-wrapped") && code.scrollWidth <= box.clientWidth + 1;
  }
  var watcher = typeof ResizeObserver === "function" ? new ResizeObserver(function (entries) { entries.forEach(function (entry) { var block = entry.target.closest(".code-block"); if (block) fit(block); }); }) : null;
  window.zaismaWatch.each(".code-block", function (block) { fit(block); if (watcher) watcher.observe(block.querySelector(".code-scroll")); });
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-code-wrap], [data-code-copy]");
    var block = button && button.closest(".code-block");
    if (!block) return;
    if (button.hasAttribute("data-code-wrap")) {
      var isWrapped = !block.classList.contains("is-wrapped");
      block.classList.toggle("is-wrapped", isWrapped); button.setAttribute("aria-pressed", String(isWrapped)); fit(block);
      return;
    }
    var code = block.querySelector(".code-lines"), said = block.querySelector(".code-said");
    function saying() { said.textContent = "Copied"; block.classList.add("is-copied"); clearTimeout(said.timer); said.timer = setTimeout(function () { said.textContent = ""; block.classList.remove("is-copied"); }, 1600); }
    // Where the clipboard isn't open to the page, the code is selected and copied the old way; when that fails too, it's left selected to copy.
    function byHand() { var range = document.createRange(); range.selectNodeContents(code); var picked = window.getSelection(); picked.removeAllRanges(); picked.addRange(range); var isCopied = false; try { isCopied = document.execCommand("copy"); } catch (error) {} if (isCopied) saying(); }
    if (navigator.clipboard && navigator.clipboard.writeText) { saying(); navigator.clipboard.writeText(code.textContent).catch(byHand); }
    else byHand();
  });
})();
`;

const RAID_SETTINGS = JSON.stringify({
  raid: "ember-gate",
  maxPlayerCount: 40,
  phases: [
    { number: 1, name: "The Gate", healthPerPlayer: 12000, roles: ["tank", "healer", "striker"], enrageAfterSeconds: 300 },
    { number: 2, name: "The Burning Court", healthPerPlayer: 18000, roles: ["tank", "healer", "striker", "runner"], enrageAfterSeconds: 420 },
  ],
  loot: { perPlayer: true, rolls: 2, rareChance: 0.08, items: ["Ember Crown", "Ashen Blade", "Gatekeeper's Ring", "Cinder Cloak"] },
  checkpoints: { afterPhase: [1], keptForHours: 2 },
  voice: { nearestPlayerCount: 16, pushToTalk: false },
  spectators: { allowed: true, delaySeconds: 30 },
  matchmaking: { regions: ["eu-west", "us-east", "ap-south"], waitSeconds: 90, fillWithBots: false },
}, null, 2);

const RAID_CODE = `// Join the raid room: up to 40 players, each phase as the boss falls
const room = await game.rooms.join("raid", { maxPlayerCount: 40 });
room.on("phase", (phase) => showPhase(phase.number, phase.name, { banner: true, sound: "horn", shakeScreen: phase.number > 1 })); /* the boss's next phase, with its banner and horn */
let shown = \`Phase \${room.phase} of 2\`;`;

component({
  name: "Code block",
  slug: "code-block",
  group: "data",
  subgroup: "reading",
  summary: "Code to read, copy or run: a post's code, a command to paste. Carved in, colored by its language, its lines scrolling sideways, and down past about twenty lines; its head says the language, with Copy, and Wrap while a line is too long to show whole. Code inside a sentence is Reading text's.",
  styles: `
/* A code block: a carved well, its head a dense slab across its top (a table's header's), the code under it in code's letters and the
   language's colors, each line its whole length, scrolling sideways on Zaisma's rail. Wrapped, the lines fold to the width. */
.code-block { margin: 0; min-width: 0; }
.code-well { display: block; min-width: 0; }
/* A grid, so the rail's frame gap under it stays inside the well instead of running out under it. */
.code-well > .well-body { padding: 0; display: grid; min-width: 0; }
/* The head's slab lies under its words and buttons rather than holding them, as a chart's axis does, so nothing it clips cuts off their
   shadows. Wrap and Copy sit at the compact frame gap from the well's top and end, so Copy's corner follows the well's. */
.code-head-slab { grid-area: 1 / 1; display: flex; pointer-events: none; filter: var(--slab-cast-pressed); }
.code-head-slab > .slab { width: 100%; height: 100%; padding: 0; }
.code-head { grid-area: 1 / 1; position: relative; z-index: 1; min-width: 0; display: flex; align-items: center; gap: var(--gap-words-words); padding: var(--pad-frame-compact) var(--pad-frame-compact) var(--pad-frame-compact) var(--pad-inside-words); }
.code-language { flex: 1; min-width: 0; font: var(--type-facts); color: var(--ink-2); }
.code-said { font: var(--type-facts); color: var(--ink); opacity: 0; transition: opacity var(--motion-state); }
.code-block.is-copied .code-said { opacity: 1; }
.code-scroll { grid-row: 2; display: grid; }
/* Long code stops at about twenty lines and scrolls down under the head, on the rail beside it, the lines keeping clear of it. */
.code-scroll[data-fades-sideways] { overflow-y: auto; max-height: min(28rem, 70dvh); }
.code-scroll.shows-rail > .code-lines { padding-inline-end: calc(var(--pad-inside-words) + var(--rail-room)); }
.code-scroll.shows-side-rail { grid-template-rows: auto calc(var(--rail-reach) + var(--rail-inset)); }
.code-scroll.shows-side-rail + .rail.sideways { margin-top: calc(-1 * (var(--rail-reach) + var(--rail-inset))); margin-bottom: var(--rail-inset); }
.code-lines { margin: 0; padding: var(--pad-inside-words); font: var(--type-code); color: var(--ink); white-space: pre; tab-size: 2; }
.code-block.is-wrapped .code-lines { white-space: pre-wrap; overflow-wrap: anywhere; }
.code-keyword { color: var(--code-keyword); }
.code-string { color: var(--code-string); }
.code-number { color: var(--code-number); }
.code-comment { color: var(--muted); font-style: italic; }
`,
  render: codeBlock,
  examples: [
    { label: "JavaScript, its lines their whole length", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(codeBlock({ code: RAID_CODE, codeLanguage: "javascript" })) }) },
    { label: "Long: about twenty lines show, the rest scroll down under the head", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(codeBlock({ code: RAID_SETTINGS, codeLanguage: "json" })) }) },
    { label: "Wrapped", isWide: true, isStill: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(codeBlock({ code: RAID_CODE, codeLanguage: "javascript", state: "is-wrapped" })) }) },
    { label: "Just copied", isStill: true, markup: glassPane({ paneWidth: "fit", body: stackOfOne(codeBlock({ code: "npx @zaisma/cli upload ./build --game ashen-crown", codeLanguage: "shell", state: "is-copied" })) }) },
    { label: "GDScript", markup: glassPane({ paneWidth: "fit", body: stackOfOne(codeBlock({ code: 'func _ready():\n\tvar health = 100 # full at the start\n\tprint("Raid ready")', codeLanguage: "gdscript" })) }) },
    { label: "No language: one color", markup: glassPane({ paneWidth: "fit", body: stackOfOne(codeBlock({ code: "ROOM 4KQ2  players=38  phase=2  tick=60hz" })) }) },
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
    { label: "In the middle", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(pager({ label: "Replies", newerHref: "#pager", olderHref: "#pager" })) }) },
    { label: "On the newest page", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(pager({ label: "Replies", olderHref: "#pager" })) }) },
  ],
});

component({
  name: "Divider",
  slug: "divider",
  group: "panes",
  subgroup: "glass",
  summary: "A hairline across a pane between two parts of it: a menu's head and its choices, a group of choices and Clear filters. With a word or two in its middle, between two ways to do one thing: or, between signing in with a password and with a passkey. Not between parts that aren't alternatives or one whole: the gap between them does that.",
  styles: `
/* A divider with words: a hairline each side of its words, in facts. A plain one is the hairline itself (materials.ts). */
.divider.has-words { display: flex; align-items: center; gap: var(--gap-words-words); margin: 0; font: var(--type-facts); color: var(--muted); }
`,
  render: divider,
  examples: [
    { label: "Between two parts of one pane: who you are, then where to go", markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: html`<p><strong>emma_r</strong> · Online</p>` }, { kind: "block", markup: divider() }, { kind: "words", markup: html`<p>Your profile · Friends · Settings</p>` }] }) }) },
    { label: "With words: between two ways in", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(divider({ words: "or" })) }) },
  ],
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
    { label: "An upload on its way", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(progress({ label: "Uploading Ashen Crown", doneNumber: 12.4, totalNumber: 48, unit: "MB" })) }) },
    { label: "No end known yet", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(progress({ label: "Scanning version 14" })) }) },
  ],
});
