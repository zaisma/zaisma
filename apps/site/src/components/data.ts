import { accountPicture, html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { secondaryButton, primaryButton, textLink } from "./actions.ts";
import type { ControlMarkup } from "./control-markup.ts";
import { CUT_LINE, MINUTE_MS, ago, glassPane, groove, icon, tag, type IconName, type TagTone } from "./foundations.ts";
import { WHEN_EMPTY_STYLES, row } from "./layout.ts";

/*
 * Data: an account's picture in its cut frame, and the glance list, one line per fact, each in its own look.
 * From the header draft (the face in the account button) and the home draft (the pane's glance list).
 */

/** From smallest to largest: a cover's facts (xs), a glance line (sm), a list row or the account button (md), a profile's head (lg). */
export type PictureSize = "xs" | "sm" | "md" | "lg";

/**
 * An account's picture (accountPicture, its initials for now) in a small frame of the panes' glass, with its drawn rim. Its frame has no
 * corners of its own, so in a pane's corner it takes the corner's cut like anything with an edge, and it's square elsewhere; never slanted.
 */
export function pictureFrame(username: string, pictureSize: PictureSize, options: { presence?: "online" | "playing" } = {}): Raw {
  // The initials are sized to the frame (--frame), so the largest frame takes the account's picture at its largest size.
  const picture = accountPicture(username, pictureSize === "lg" ? "md" : pictureSize, { title: "" });
  const presenceMarks = (presence: "online" | "playing") => html`<span class="presence-line" aria-hidden="true"></span>${presence === "playing" ? html`<span class="presence-play" aria-hidden="true">${icon("play")}</span>` : ""}`;
  const frame = html`<span class="frame ${pictureSize} glass" data-glass data-glass-corners="0 0 0 0" data-glass-band="2" aria-hidden="true"><span class="frame-picture">${picture}</span></span>`;
  // The glass is clipped to its edge, so the presence marks sit outside it, in room the frame keeps under it: a green line along its foot,
  // and for playing a green tab with a play mark at the line's end.
  return options.presence
    ? html`<span class="frame-presence ${pictureSize}">${frame}${presenceMarks(options.presence)}</span>`
    : frame;
}

/** Friends' pictures in a row, front to back: each lies over the next, casting a small shadow onto it; past three, the rest are a +N at the back. */
export function pictureRow(usernames: string[], pictureSize: PictureSize): Raw {
  const shown = usernames.slice(0, 3), hiddenCount = usernames.length - shown.length, placeCount = shown.length + (hiddenCount > 0 ? 1 : 0);
  return html`<span class="picture-row ${pictureSize}">${shown.map(
    (username, placeIndex) => html`<span class="picture-row-place" style="z-index:${placeCount - placeIndex}">${pictureFrame(username, pictureSize)}</span>`,
  )}${hiddenCount > 0 ? html`<span class="picture-row-place" style="z-index:1"><span class="frame ${pictureSize} glass more" data-glass data-glass-corners="0 0 0 0" data-glass-band="2" aria-hidden="true">+${hiddenCount}</span></span>` : ""}</span>`;
}

/** Names as a sentence: "Liam", "Liam and Sofia", "Liam, Sofia and Noah". */
const nameList = (names: string[]) => (names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** A number keeps its unit: a no-break space between them, so nothing reads "48 / MB" or "3 / days ago". */
const keepUnits = (words: string) => words.replace(/(\d)\s+(?=[A-Za-z%])/g, "$1\u00a0");

/**
 * A line of facts said with " · " between them ("2 days ago · 312 files · 48 MB"): each fact wraps whole, onto the next line when it
 * doesn't fit, its " ·" kept with it so no line starts with one, and a number keeps its unit.
 */
const factLine = (words: string, factClass: string): Raw => {
  const facts = words.split(" · ");
  return html`${facts.map((fact, factIndex) => html`${factIndex ? " " : ""}<span class="${factClass}">${keepUnits(fact)}${factIndex < facts.length - 1 ? "\u00a0·" : ""}</span>`)}`;
};

export interface GlanceFacts {
  playerCount?: number;
  /** When you last played it. */
  playedAtMs?: number;
  /** When it was last updated; say it only when that's news to you. */
  updatedAtMs?: number;
  /** Where its patch notes are, for the Updated line. */
  updatesHref?: string;
  /** Friends playing it now. */
  friends?: { username: string }[];
  /** Why their room can't be joined or watched from here ("Room full"), each a tag at the end of the friends' line. */
  friendsRefusalNotes?: string[];
  /** Why it may not suit this device ("Needs a keyboard"), for a game made for others; said instead of when you played or friends. */
  deviceNote?: string;
  /** A paid game's price to play ("$24.99"), for a viewer who doesn't own it: a tag on its cover. */
  priceText?: string;
}

/** The glance list: one line per fact, each with its own look. People and a clock are line icons; friends are their pictures; an update is a green tag. */
export function glanceFacts(facts: GlanceFacts): Raw {
  const nowMs = Date.now();
  const friends = facts.friends ?? [];
  return html`<ul class="glance words-margin hairline-above">${facts.deviceNote ? html`<li>${icon("info")}<span>${facts.deviceNote}</span></li>` : ""}${facts.playerCount !== undefined ? html`<li>${icon("people")}<span><b>${facts.playerCount.toLocaleString("en-US")}</b> playing now</span></li>` : ""}${
    friends.length ? html`<li class="friends">${pictureRow(friends.map((friend) => friend.username), "sm")}<span><span class="glance-whole"><b class="one-line">${nameList(friends.map((friend) => friend.username))}</b><span>\u00a0${friends.length > 1 ? "are" : "is"} playing</span></span>${(facts.friendsRefusalNotes ?? []).map((note) => html` <span class="glance-fact">${tag(note, "plain")}</span>`)}</span></li>` : ""
  }${facts.playedAtMs !== undefined ? html`<li>${icon("clock")}<span>You played ${keepUnits(ago(nowMs - facts.playedAtMs))}</span></li>` : ""}${
    facts.updatedAtMs !== undefined ? html`<li>${tag("Updated", "new")}<span>${keepUnits(ago(nowMs - facts.updatedAtMs))}${facts.updatesHref ? html`\u00a0· <span class="glance-fact">${textLink("What's new", facts.updatesHref)}</span>` : ""}</span></li>` : ""
  }</ul>`;
}

export const GLANCE_STYLES = `
/* The glance list: one line per fact, each with its own look. People and a clock are line icons; friends are their pictures; an update is a green tag.
   What leads each line sits in a column of its own, so every line's words start at one place, however wide its lead. */
.glance { list-style: none; margin: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--gap-words-words); font: var(--type-words); color: var(--ink-2); }
/* Under something else in its pane (a game's title), a hairline parts them; at the top of its pane it needs none. */
.glance li { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; min-height: 24px; }
.glance li > :first-child { justify-self: start; }
.glance b { font-weight: 600; color: var(--ink); }
.glance .ico { color: var(--muted); stroke-width: 1.5; }
/* A link after the facts goes onto the next line whole, never split. */
.glance-fact { display: inline-block; }
/* "Liam and Sofia are playing" stays on one line, so a row it leads (with Join or Watch) can't squeeze it a word to a line; a tag after it
   goes under it instead, and names too long for the line end in an ellipsis, "are playing" always shown. */
.glance-whole { display: inline-flex; max-width: 100%; white-space: nowrap; vertical-align: bottom; }
.glance li > :last-child { min-width: 0; }
/* Before a row's buttons, the row's own gap parts them; the words margin is only for the pane's edge. */
.row-cell:not(:last-child) > .glance { padding-inline-end: 0; }
`;

component({
  name: "Picture frame",
  slug: "picture-frame",
  group: "data",
  subgroup: "pictures",
  summary: "An account's picture, always in its frame of glass: in the account button, beside a friend's name, at the head of a profile.",
  styles: `
/* An account's picture under a small frame of the panes' glass. Square, except in a pane's corner, where it takes the corner's cut like
   anything with an edge (the edge rule); never slanted. The glass itself
   is clear (no tint of its own), so the picture runs right to its edges and the drawn rim lies over the picture's own colors, the way a
   pane's edge takes the color of what's under it. */
.frame { --frame: 44px; position: relative; display: inline-grid; place-items: center; width: var(--frame); height: var(--frame); flex: none;
  font: var(--type-tag); color: var(--ink); }
.frame.lg { --frame: 96px; }
.frame.sm { --frame: 32px; }
.frame.xs { --frame: 24px; }
.frame:not(.more) { --glass-tint: transparent; }
.frame.glass > .frame-picture { position: absolute; z-index: 2; inset: 0; }
/* A quiet rim: half the panes' strength, so it reads as glass without framing the face. */
.frame.glass > .edge { z-index: 4; opacity: 0.5; }
/* An account's picture fills its frame, or the slab that holds it as art (your picture as the account button). */
:is(.frame, .slab.holds-art) .av { position: absolute; inset: 0; width: 100%; height: 100%; display: grid; place-items: center; font: 600 calc(var(--frame, var(--control-height)) * 0.38) var(--display); color: #fff; letter-spacing: 0.01em;
  background: linear-gradient(140deg, hsl(var(--h) 58% 58%), hsl(calc(var(--h) + 45) 48% 52%) 55%, hsl(calc(var(--h) + 90) 48% 55%)); }
/* Presence, under the picture: online is a green line along its foot, like the orange line under what you're on; playing adds a green tab at the
   line's right end holding a white play mark, lying over the picture's corner. The frame keeps room under it for them (the glass is clipped
   to its edge, so they sit outside it), so nothing hangs into what's below: the marks are part of the picture's footprint. It's as tall as
   the frame and that room, never stretched by a row round it, so the marks stay under the picture. */
.frame-presence { position: relative; display: inline-flex; flex: none; height: fit-content;
  --presence-gap: 3px; --presence-line: 3px; --presence-tab-width: 22px; --presence-tab-height: 14px;
  padding-bottom: calc(var(--presence-gap) + var(--presence-line)); }
.frame-presence.xs { --presence-gap: 2px; --presence-line: 2px; --presence-tab-width: 16px; --presence-tab-height: 11px; }
.frame-presence.lg { --presence-gap: 4px; --presence-line: 4px; --presence-tab-width: 32px; --presence-tab-height: 20px; }
.presence-line { position: absolute; z-index: 4; left: 0; right: 0; bottom: 0; height: var(--presence-line); background: var(--online);
  clip-path: polygon(2px 0, 100% 0, calc(100% - 2px) 100%, 0 100%); }
.presence-play { position: absolute; z-index: 5; right: 0; bottom: 0; display: grid; place-items: center; width: var(--presence-tab-width); height: var(--presence-tab-height); color: #fff; background: var(--online);
  box-shadow: 0 1px 3px var(--picture-shadow); clip-path: polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%); }
/* The play mark is small in its tab, with green all round it, so it reads as a mark and not a cut in the tab. */
.presence-play > .play { width: calc(var(--presence-tab-height) * 0.36); height: calc(var(--presence-tab-height) * 0.42); transform: translateX(0.5px); }
/* A cut frame (your picture at the header's end) holds its presence inside, along its foot, under its rim. */
/* The smallest shows only the first letter. */
.frame.xs .av { display: block; text-align: center; line-height: var(--frame); font-size: 0; }
.frame.xs .av::first-letter { font-size: 11px; }
`,
  render: pictureFrame,
  examples: [
    { label: "Big", markup: pictureFrame("emma_r", "md") },
    { label: "Online", markup: pictureFrame("emma_r", "md", { presence: "online" }) },
    { label: "Playing", markup: pictureFrame("emma_r", "md", { presence: "playing" }) },
    { label: "Small: online, playing", markup: html`${pictureFrame("Liam", "sm", { presence: "online" })}${pictureFrame("Sofia", "sm", { presence: "playing" })}` },
    { label: "Smallest: online, playing", markup: html`${pictureFrame("Mia", "xs", { presence: "online" })}${pictureFrame("Noah", "xs", { presence: "playing" })}` },
    { label: "Small", markup: pictureFrame("Liam", "sm") },
    { label: "Smallest", markup: pictureFrame("Mia", "xs") },
    { label: "A profile's head: playing, online", markup: html`${pictureFrame("Sofia", "lg", { presence: "playing" })}${pictureFrame("Lucas", "lg", { presence: "online" })}` },
  ],
});

component({
  name: "Picture row",
  slug: "picture-row",
  group: "data",
  subgroup: "pictures",
  summary: "Friends' pictures together: front to back, each lying over the next with a small shadow, all square. Past three, the rest are a +N.",
  styles: `
/* A row, front to back: each picture lies over the left of the next and casts a small shadow onto it, so the one in front reads as on top.
   Past three, a +N of the same glass sits at the back. */
.picture-row { display: inline-flex; flex: none; }
.picture-row-place { position: relative; display: inline-flex; }
/* The shadow is its own layer under the picture (the glass is clipped to its edge, so it can't cast one), falling to the right onto the next. */
.picture-row-place:not(:last-child)::after { content: ""; position: absolute; inset: 0; z-index: -1; box-shadow: 3px 0 6px -1px var(--picture-shadow); }
.picture-row-place + .picture-row-place { margin-left: calc(var(--frame-overlap) * -1); }
/* Behind the first, a picture's initials (or the +N) center in the part that shows, never under the one in front. */
.picture-row-place + .picture-row-place .av, .picture-row-place + .picture-row-place > .frame.more { padding-inline-start: var(--frame-overlap); }
/* A picture behind another shows only its first letter, so its part that shows holds it with room round it, as a whole picture does. */
.picture-row-place + .picture-row-place .av { display: block; text-align: center; line-height: var(--frame); font-size: 0; }
.picture-row-place + .picture-row-place .av::first-letter { font-size: calc(var(--frame) * 0.38); }
.picture-row.lg { --frame-overlap: 24px; }
.picture-row.md { --frame-overlap: 12px; }
.picture-row.sm { --frame-overlap: 9px; }
.picture-row.xs { --frame-overlap: 7px; }
/* The +N is sized to its frame, like the initials in a picture. */
.frame.more { font: 600 calc(var(--frame) * 0.36)/1 var(--display); font-variant-numeric: tabular-nums; }
`,
  render: pictureRow,
  examples: [
    { label: "Three friends, front to back", markup: pictureRow(["Liam", "Sofia", "Noah"], "sm") },
    { label: "Seven: three, then +4", markup: pictureRow(["Liam", "Sofia", "Noah", "Mia", "Lucas", "Emma", "Oliver"], "sm") },
    { label: "Big, in a row", markup: pictureRow(["Liam", "Sofia", "Noah", "Mia"], "md") },
    { label: "Smallest, in a row (a cover's facts)", markup: pictureRow(["Liam", "Sofia", "Noah", "Mia", "Lucas"], "xs") },
  ],
});

/** What a version is now, as every list and table of versions says it: from its scan_status, is_live, scheduled_publish_at and replaced_by_version_id. */
export type VersionState = "scanning" | "held" | "rejected" | "passed" | "scheduled" | "live" | "replaced";

/** A version's state as its Tag, the same wherever versions are listed: live is green, held and rejected amber, the rest plain words. */
export const VERSION_STATE_TAGS: Record<VersionState, Raw> = {
  live: tag("Live", "new"),
  passed: tag("Passed", "count"),
  scheduled: tag("Scheduled", "count"),
  scanning: tag("Scanning", "count"),
  held: tag("Held", "warning"),
  rejected: tag("Rejected", "warning"),
  replaced: tag("Replaced", "plain"),
};

component({
  name: "Tag",
  slug: "tag",
  group: "data",
  subgroup: "lists",
  summary: "A few words or a number carved into what they label, slanted at both ends: Updated on a game, the count of unread topics on a place, a version's state. On glass, a mark's name on the rail.",
  styles: `
/* A tag is the carving's smallest form (materials.ts): new, a count, plain or a warning, or glass. */
/* An icon before its words, small and in their color, says what kind of tag it is at a glance. */
.tag:has(> .ico) { gap: 4px; }
.tag > .ico { width: 12px; height: 12px; stroke-width: 2; }
.tag.glass { color: var(--ink); --glass-tint: var(--glass-dropdown); }
`,
  render: (words: string | number, tone: TagTone, options?: { icon?: IconName }) => tag(words, tone, options),
  examples: [
    { label: "New", markup: tag("Updated", "new") },
    { label: "A count", markup: tag(3, "count") },
    { label: "Plain words", markup: tag("Replaced", "plain") },
    { label: "With an icon", markup: html`${tag("Held", "warning", { icon: "warning" })} ${tag("Developer", "plain", { icon: "code" })}` },
    { label: "A warning", markup: tag("Held", "warning") },
    { label: "On glass", markup: tag("Continue playing", "glass") },
    { label: "A version's state, the same everywhere", isWide: true, markup: html`${Object.values(VERSION_STATE_TAGS)}` },
  ],
});

const HOUR_MS = 60 * MINUTE_MS;
const glancePane = (body: Raw) => glassPane({ paneWidth: "fit", body });

component({
  name: "Glance facts",
  slug: "glance-facts",
  group: "data",
  subgroup: "lists",
  summary: "What concerns you about a game at a glance: players now, friends playing, when you played, an update. Only what's true, one line each.",
  styles: GLANCE_STYLES,
  render: glanceFacts,
  examples: [
    { label: "Players now", markup: glancePane(glanceFacts({ playerCount: 1204 })) },
    { label: "Friends playing", markup: glancePane(glanceFacts({ friends: [{ username: "Liam" }, { username: "Sofia" }] })) },
    { label: "When you played", markup: glancePane(glanceFacts({ playedAtMs: Date.now() - 2 * HOUR_MS })) },
    { label: "Updated", markup: glancePane(glanceFacts({ updatedAtMs: Date.now() - 26 * HOUR_MS, updatesHref: "#glance-facts" })) },
    {
      label: "All four",
      markup: glancePane(glanceFacts({ playerCount: 1204, friends: [{ username: "Liam" }, { username: "Sofia" }, { username: "Noah" }], playedAtMs: Date.now() - 3 * 24 * HOUR_MS, updatedAtMs: Date.now() - 26 * HOUR_MS, updatesHref: "#glance-facts" })),
    },
  ],
});

interface ListRowParts {
  title: string;
  /**
   * A line under its title, in quiet words. Facts in it are said with " · " between them ("2 days ago · 312 files · 48 MB"): each wraps
   * whole, and a number keeps its unit.
   */
  detail?: string;
  /** A second line under the first, said the same way: when it was last used, what it's waiting for. */
  secondDetail?: string;
  /** What leads the row, before its title: a Picture frame (a player, a friend) or an icon (a key, a passkey). */
  lead?: Raw;
  /** An icon right after its title that says one thing about it (a friend), with its words for a screen reader and a pointer's tooltip. */
  titleIcon?: { icon: IconName; label: string; isHidden?: boolean };
  /** What sits at its end: a Tag (a version's state is VERSION_STATE_TAGS') or a few words. */
  end?: Raw | string;
  /** A Usage meter's track under its lines, its numbers said in the detail: a game's hosting this month. */
  meter?: UsageMeterOptions;
  /** The gallery's fixed states. */
  state?: "is-pointed" | "is-pressed" | "is-focused";
  /**
   * A row with an address that opens it in a new tab, away from Zaisma (a developer's links beside a running game): it ends in the
   * out-of-the-page arrow in place of the chevron.
   */
  isNewTab?: boolean;
  /** Not shown for now: a page script shows it (a long list's rows past the first ten, after Show all). It takes no room and no hairline. */
  isHidden?: boolean;
}

/**
 * A row that goes somewhere is a link as a whole, so it never holds a button; a row to read may end in one (Remove, Invite), or in a few
 * small ones side by side (a player in a room: Mute, and ⋯ for the rest).
 */
export type ListRow = ListRowParts & ({ href: string; action?: never } | { href?: undefined; action?: ControlMarkup | ControlMarkup[] });

/** A row's buttons side by side, slanting toward each other. */
const rowOf = (actions: ControlMarkup[]) => row({ widths: "fit", items: actions.map((markup) => ({ kind: "control" as const, markup })) });

/**
 * List rows: a list on glass, one thing a row with hairlines between (versions, keys, topics, players); a row with an address is a link as a whole.
 * whenEmpty (an Empty state) shows in its place while it has no rows shown, a page script's rows included (WHEN_EMPTY_STYLES).
 */
export function listRows(options: { rows: ListRow[]; whenEmpty: Raw; id?: string; label?: string; shownRowCount?: number; isCompact?: boolean }): Raw {
  const cap = options.shownRowCount ? html` style="--shown-row-count:${String(options.shownRowCount)}"` : "";
  return html`${listMarkup(options, cap)}${whenEmptyMarkup(options.whenEmpty, options.rows.some((row) => !row.isHidden))}`;
}

/**
 * What shows in a list's place while it has nothing in it: right after the list, which hides itself while it's empty (WHEN_EMPTY_STYLES).
 * Hidden while the list has things, so the layout's edge rules see the list as what ends its pane.
 */
const whenEmptyMarkup = (whenEmpty: Raw, isListShown: boolean): Raw => html`<div class="when-empty"${isListShown ? raw(" hidden") : ""}>${whenEmpty}</div>`;

function listMarkup(options: { rows: ListRow[]; id?: string; label?: string; shownRowCount?: number; isCompact?: boolean }, cap: Raw | ""): Raw {
  return html`<ul class="list-rows hairlines${options.shownRowCount ? " is-capped scrolls own-scroll" : ""}${options.isCompact ? " is-compact" : ""}"${cap}${options.id ? html` id="${options.id}"` : ""}${options.label ? html` aria-label="${options.label}"` : ""}>${options.rows.map((row) => {
    const details = [row.detail, row.secondDetail].filter((line): line is string => Boolean(line));
    const inside = html`${row.lead ? html`<span class="list-row-lead">${row.lead}</span>` : ""}<span class="list-row-words">${row.titleIcon ? html`<span class="list-row-title-line"><span class="list-row-title">${row.title}</span><span class="list-row-title-icon" role="img" aria-label="${row.titleIcon.label}" title="${row.titleIcon.label}"${row.titleIcon.isHidden ? raw(" hidden") : ""}>${icon(row.titleIcon.icon)}</span></span>` : html`<span class="list-row-title">${row.title}</span>`}${details.map((line) => html`<span class="list-row-detail">${factLine(line, "list-row-fact")}</span>`)}${row.meter ? html`<span class="list-row-meter">${usageTrack(row.meter)}</span>` : ""}</span>${row.end !== undefined ? html`<span class="list-row-end">${row.end}</span>` : ""}`;
    return html`<li${row.isHidden ? raw(" hidden") : ""}>${row.href
      ? html`<a class="list-row flush-row is-link${row.state ? ` ${row.state}` : ""}" href="${row.href}"${row.isNewTab ? raw(' target="_blank" rel="noopener noreferrer"') : ""} data-cut-line="8">${CUT_LINE}${inside}<span class="list-row-go${row.isNewTab ? " is-new-tab" : ""}" aria-hidden="true">${icon(row.isNewTab ? "out-of-page" : "chevron-right")}</span></a>`
      : html`<div class="list-row flush-row quiet">${inside}${row.action ? html`<span class="list-row-action">${Array.isArray(row.action) ? rowOf(row.action) : row.action}</span>` : ""}</div>`}</li>`;
  })}</ul>`;
}

const VERSION_LIST_ROWS: ListRow[] = [
  { title: "Version 15", detail: "An hour ago · 314 files · 49.2 MB", href: "#list-rows", end: VERSION_STATE_TAGS.held },
  { title: "Version 14", detail: "2 days ago · 312 files · 48.1 MB", href: "#list-rows", end: VERSION_STATE_TAGS.live },
  { title: "Version 13", detail: "5 days ago · 309 files · 47.6 MB", href: "#list-rows", end: VERSION_STATE_TAGS.replaced },
];
const listPane = (rows: ListRow[]) => glassPane({ paneWidth: "fit", body: listRows({ rows, whenEmpty: html`<p>No versions yet.</p>` }) });
const ROW_BUTTON = { type: "button", isSmall: true } as const;

component({
  name: "List rows",
  slug: "list-rows",
  group: "data",
  subgroup: "lists",
  summary: "A list of things on glass, one a row with hairlines between: versions, keys, topics, players. A row that goes somewhere is a link as a whole, ending in a chevron that steps on as you point; a row to read may end in a button.",
  styles: `
/* List rows: one thing a row, hairlines between. A row that's a link ends in a small chevron; under the pointer the row brightens a little
   (a faint slab, cut by the edge rule), an orange mark rises at its start, and the chevron steps on, the way the guest button's arrow does.
   A row may lead with a picture or an icon, take a second line of details, and, when it isn't a link, end in a button. */
.list-rows { list-style: none; margin: 0; padding: 0; display: grid; }
/* Capped: about shownRowCount rows in view, half of the next showing so it's clear the list scrolls inside itself, the page staying short. It holds a swipe or a wheel only while it has something to scroll (is-scrollable, tokens.ts): a short list passes it on to the page. */
.list-rows.is-capped { --list-row-height: 65px; max-height: calc((var(--shown-row-count) + 0.5) * var(--list-row-height)); }
/* With its rail showing (the rail lies along its right edge), the rows keep clear of it, so a row's button never sits against the rail. */
.list-row { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-words-control); --row-height: 60px; --row-block: 10px; --row-start: var(--pad-inside-words); --row-end: var(--pad-inside-words); color: var(--ink); text-decoration: none; }
.list-row.quiet { cursor: auto; }
.list-row > :not(.cut-line) { position: relative; z-index: 2; }
.list-row-lead { flex: none; display: inline-flex; color: var(--ink-2); }
/* Compact: a long list in a narrow place (the players in a room): one line a row, its words taking what's left beside its picture and buttons. */
.list-rows.is-compact > li > .list-row { flex-wrap: nowrap; --row-height: 44px; --row-block: calc(var(--gap-control-stack) * 0.75); }
.list-rows.is-compact .list-row-words { flex: 1 1 0; }
.list-row-lead > .ico { width: 20px; height: 20px; }
/* The words keep a card's width at least: where the buttons don't fit beside that, they go under the words, at the row's end. */
.list-row-words { display: grid; gap: var(--gap-words-words); min-width: 0; flex: 1 1 min(100%, var(--size-card)); }
/* A long title wraps rather than being cut short, a web address anywhere. */
.list-row-title { font: var(--type-label); color: var(--ink); overflow-wrap: anywhere; }
.list-row-detail { font: var(--type-facts); color: var(--muted); }
/* An icon after the title (a friend's mark), in the second words' color, on the title's line. */
.list-row-title-line { display: flex; align-items: center; gap: var(--gap-words-words); min-width: 0; }
.list-row-title-icon { flex: none; display: inline-flex; color: var(--ink-2); }
.list-row-title-icon > .ico { width: 16px; height: 16px; }
/* A meter under its lines: only the track, its numbers in the detail above. */
.list-row-meter { display: grid; }
.list-row-fact { display: inline-block; max-width: 100%; }
.list-row-end { flex: none; display: inline-flex; align-items: center; gap: var(--gap-words-words); font: var(--type-facts); color: var(--ink-2); }
.list-row-action { flex: none; display: inline-flex; margin-left: auto; }
.list-row-go { flex: none; display: inline-flex; color: var(--muted); transition: transform var(--motion-glide) var(--ease-glide), color var(--motion-state); }
.list-row-go > .ico { width: 8px; height: 13px; stroke-width: 2.2; }
/* A row that opens a new tab ends in the out-of-the-page arrow, which steps up and out as you point. */
.list-row-go.is-new-tab > .ico { width: 16px; height: 16px; stroke-width: 1.8; }
/* The mark at its start: a short orange bar, cut at its ends, growing from its middle, halfway between the row's edge and its words. */
.list-row.is-link:hover > .list-row-go, .list-row.is-link.is-pointed > .list-row-go { transform: translateX(3px); color: var(--ink); }
.list-row.is-link:hover > .list-row-go.is-new-tab, .list-row.is-link.is-pointed > .list-row-go.is-new-tab { transform: translate(2px, -2px); }
@media (prefers-reduced-motion: reduce) { .list-row-go { transition: none; } }
`,
  render: listRows,
  examples: [
    { label: "Rows that go somewhere", isWide: true, markup: listPane(VERSION_LIST_ROWS) },
    {
      label: "Compact: a long list in a narrow place, one line a row (the players in a room)",
      markup: html`<div style="width:320px">${glassPane({ paneWidth: "full", body: listRows({ isCompact: true, whenEmpty: html`<p>Nobody here yet.</p>`, rows: ["Liam", "Sofia", "Emma Charlotte Fairweather-Lindqvist"].map((name, index) => ({ lead: pictureFrame(name, "sm"), title: name, titleIcon: index ? undefined : { icon: "friends" as const, label: "Friend" }, action: [secondaryButton(`Mute ${name}`, { type: "button", icon: "speaker", isLabelHidden: true, isSmall: true }), secondaryButton(`More for ${name}`, { type: "button", icon: "more", isLabelHidden: true, isSmall: true })] })) }) })}</div>`,
    },
    { label: "Pointed", markup: listPane([{ title: "Ashen Crown", detail: "Unlisted · 2,318 players this week", href: "#list-rows", state: "is-pointed" }]), isStill: true },
    { label: "Pressed", markup: listPane([{ title: "Ashen Crown", detail: "Unlisted · 2,318 players this week", href: "#list-rows", state: "is-pressed" }]), isStill: true },
    { label: "Keyboard focus", markup: listPane([{ title: "Ashen Crown", detail: "Unlisted · 2,318 players this week", href: "#list-rows", state: "is-focused" }]), isStill: true },
    { label: "A long title wraps", markup: listPane([{ title: "Ashen Crown: Chronicles of the Long Winter, Definitive Edition", detail: "Listed · 18,420 players this week", href: "#list-rows", end: VERSION_STATE_TAGS.live }]) },
    {
      label: "Led by pictures, a button a row",
      isWide: true,
      markup: listPane([
        { lead: pictureFrame("Sofia", "md", { presence: "playing" }), title: "Sofia", detail: "Playing Ashen Crown", action: secondaryButton("Invite", ROW_BUTTON) },
        { lead: pictureFrame("Liam", "md", { presence: "online" }), title: "Liam", detail: "Online", action: secondaryButton("Invite", ROW_BUTTON) },
        { lead: pictureFrame("Noah", "md"), title: "Noah", detail: "Played 3 days ago", action: secondaryButton("Invite", ROW_BUTTON) },
      ]),
    },
    {
      label: "A few buttons a row: players in a room",
      isWide: true,
      markup: listPane([
        { lead: pictureFrame("Sofia", "md"), title: "Sofia", detail: "Friend", action: [secondaryButton("Mute", ROW_BUTTON), secondaryButton("More for Sofia", { ...ROW_BUTTON, icon: "more", isLabelHidden: true })] },
        { lead: pictureFrame("Liam", "md"), title: "Liam", detail: "Muted", action: [secondaryButton("Unmute", ROW_BUTTON), secondaryButton("More for Liam", { ...ROW_BUTTON, icon: "more", isLabelHidden: true })] },
      ]),
    },
    {
      label: "Led by icons, with a second line",
      isWide: true,
      markup: listPane([
        { lead: icon("passkey"), title: "MacBook Pro", detail: "iCloud Keychain · added Oct 2", secondDetail: "Used today", action: secondaryButton("Remove", ROW_BUTTON) },
        { lead: icon("key"), title: "Claude", detail: "Reads, uploads · made Oct 12", secondDetail: "Used an hour ago", action: secondaryButton("Remove", ROW_BUTTON) },
      ]),
    },
    {
      label: "With a meter under its lines: games' hosting this month",
      isWide: true,
      markup: listPane([
        { title: "Ashen Crown", detail: "Free part used · $3.54 of its $5 budget · Resets Nov 1", meter: { label: "Ashen Crown", usedNumber: 242, limitNumber: 300, warnFromNumber: 260, unit: "", isFullFine: true }, action: secondaryButton("Budget", ROW_BUTTON) },
        { title: "Kestrel", detail: "All of this month's free hosting · Resets Nov 1", secondDetail: "No budget: it stops at its free allowance.", end: tag("Paused", "warning"), meter: { label: "Kestrel", usedNumber: 100, limitNumber: 100, unit: "%" }, action: secondaryButton("Budget", ROW_BUTTON) },
      ]),
    },
    {
      label: "Opening in a new tab: a developer's links beside a running game",
      isWide: true,
      markup: listPane([
        { lead: icon("globe"), title: "Wishlist on Steam", detail: "store.steampowered.com", href: "#list-rows", isNewTab: true },
        { lead: icon("globe"), title: "ashencrown.com", href: "#list-rows", isNewTab: true, state: "is-pointed" },
      ]),
    },
    {
      label: "A row hidden for now: a page script shows it, after Show all",
      markup: listPane([{ title: "Version 15", detail: "An hour ago", href: "#list-rows" }, { title: "Version 14", detail: "2 days ago", href: "#list-rows" }, { title: "Version 13", detail: "5 days ago", href: "#list-rows", isHidden: true }]),
    },
    { label: "Rows to read, not to open", markup: listPane([{ title: "Claude", detail: "Made Oct 12 · used an hour ago", end: "Reads, uploads" }, { title: "Build server", detail: "Made Sep 30 · used yesterday", end: "Uploads" }]) },
  ],
});

export interface StateNoteOptions {
  title: string;
  text: string;
  /** What to do about it: one button from Actions, full width (isFullWidth). It sits at the note's foot, so at a pane's foot it takes the pane's cut. */
  action?: ControlMarkup;
}

/** The words and the button of an empty, problem or done state, with the mark that leads a problem or a done one. */
const stateNote = (tone: "" | " problem" | " done", options: StateNoteOptions, mark: Raw | "") =>
  html`<div class="state-note${tone}${options.action ? " has-action" : ""}">${mark}<div class="state-words words-margin"><p class="state-title">${options.title}</p><p class="state-text">${options.text}</p></div>${options.action ? html`<div class="state-action">${options.action}</div>` : ""}</div>`;

/** An empty state: what will be here and how it gets here, where a list has nothing yet. */
export function emptyState(options: StateNoteOptions): Raw {
  return stateNote("", options, "");
}

const STATE_STYLES = `
/* An empty, problem or done state: a few words in the middle of where the content would be, what it is and what to do, and at most one
   button for it, filling the width at the note's foot like any control in a pane. Never a picture. */
.state-note { display: grid; justify-items: center; gap: var(--gap-words-control); padding: var(--gap-block-block) 0; text-align: center; }
.state-note.has-action { padding-bottom: 0; }
.state-note > .ico { width: 24px; height: 24px; color: var(--marked); }
.state-note.done > .ico { color: var(--tag-new-ink); }
.state-words { display: grid; gap: var(--gap-words-words); max-width: 46ch; }
.state-title { margin: 0; font: var(--type-name); color: var(--ink); }
.state-text { margin: 0; font: var(--type-words); color: var(--ink-2); }
.state-action { justify-self: stretch; display: grid; margin-top: calc(var(--gap-block-block) - var(--gap-words-control)); }
`;

component({
  name: "Empty state",
  slug: "empty-state",
  group: "data",
  subgroup: "states",
  summary: "Where a list has nothing yet: what will be here, how it gets here, and the button that starts it. In the voice, never a picture.",
  styles: STATE_STYLES + WHEN_EMPTY_STYLES,
  render: emptyState,
  examples: [
    { label: "With what starts it", markup: glassPane({ paneWidth: "fit", body: emptyState({ title: "No games yet", text: "Make one from your AI, or upload a folder with an index.html from your terminal.", action: primaryButton("Make a game", { type: "button", isFullWidth: true }) }) }) },
    { label: "Words alone", markup: glassPane({ paneWidth: "fit", body: emptyState({ title: "No friends playing", text: "When a friend plays something, it shows here." }) }) },
  ],
});

/** A problem state: what went wrong where the content would be, and what to do (Try again). */
export function problemState(options: StateNoteOptions): Raw {
  return stateNote(" problem", options, icon("warning"));
}

component({
  name: "Problem state",
  slug: "problem-state",
  group: "data",
  subgroup: "states",
  summary: "Where content couldn't come: what went wrong in plain words, and what to do about it, like Try again.",
  styles: "",
  render: problemState,
  examples: [
    { label: "With what to do", markup: glassPane({ paneWidth: "fit", body: problemState({ title: "Couldn't load your versions", text: "Zaisma didn't answer in time. Nothing is lost.", action: secondaryButton("Try again", { type: "button", isFullWidth: true }) }) }) },
    { label: "Words alone", markup: glassPane({ paneWidth: "fit", body: problemState({ title: "This game isn't shown where you are", text: "Its developer keeps it from players in your country." }) }) },
  ],
});

/** A done state: what was just done, in place of the task it ends (a report sent), and the way on from it. */
export function doneState(options: StateNoteOptions): Raw {
  return stateNote(" done", options, icon("check"));
}

component({
  name: "Done state",
  slug: "done-state",
  group: "data",
  subgroup: "states",
  summary: "Where a task just ended, in place of it: what was done and what happens next, like a report sent. A moment that passes is a Notice instead.",
  styles: "",
  render: doneState,
  examples: [
    { label: "With the way on", markup: glassPane({ paneWidth: "fit", body: doneState({ title: "Report sent", text: "Zaisma looks at it within a day and tells you what it did.", action: secondaryButton("Close", { type: "button", isFullWidth: true }) }) }) },
    { label: "Words alone", markup: glassPane({ paneWidth: "fit", body: doneState({ title: "Version 15 is live", text: "Players get it the next time they open the game." }) }) },
  ],
});

/** A loading state: a hairline with a light running along it, and what's coming, where the content will be. Never a spinner over content. */
export function loadingState(options: { label: string }): Raw {
  return html`<div class="loading-state words-margin round" role="status"><span class="loading-line" aria-hidden="true"></span><span class="loading-label">${options.label}</span></div>`;
}

component({
  name: "Loading state",
  slug: "loading-state",
  group: "data",
  subgroup: "states",
  summary: "Where content is on its way: a hairline with a light running along it, and what's coming. Never a spinner over content; a button that's waiting shows the loader instead.",
  styles: `
/* Loading: a hairline across where the content will be, a light running along it the way it runs along a cover's line, and its words
   under it. Under reduced motion the light rests in the middle. */
.loading-state { display: grid; gap: var(--gap-words-control); justify-items: center; }
.loading-line { position: relative; display: block; width: min(240px, 100%); height: 2px; overflow: hidden; background: var(--line); }
.loading-line::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--ink) 70%, transparent), transparent); animation: loading-run var(--motion-loop) var(--ease-standard) infinite; }
@keyframes loading-run { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.loading-label { font: var(--type-facts); color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .loading-line::after { animation: none; transform: translateX(75%); } }
`,
  render: loadingState,
  examples: [{ label: "Loading", markup: glassPane({ paneWidth: "fit", body: loadingState({ label: "Getting your versions" }) }) }],
});

export interface TableColumn {
  label: string;
  /** Its cells are numbers: right-aligned, in figures of one width, so a column's digits line up. */
  isNumeric?: boolean;
  /** Its cells are long words (what a scan found, a message): they wrap, at least a card's width wide, instead of running on. */
  isLongText?: boolean;
  /** Its cells are the row's buttons (small Secondary buttons, side by side): at the row's end, its heading said only to screen readers. */
  isActions?: boolean;
}

/** A cell with a quieter second line under its words: a top-up's "Credit added" and until when it refunds. */
export interface TableCell {
  text: Raw | string;
  detail: string;
}

export interface TableOptions {
  /** What the table is, said above it (it stays put as the table scrolls sideways) and to screen readers. */
  caption: string;
  columns: TableColumn[];
  /** One list of cells a row, in the columns' order. */
  rows: (Raw | string | TableCell)[][];
  /** The first column names each row (a version, a player): it's the row's head, and stays put as the table scrolls sideways. */
  hasRowHeads?: boolean;
  /** Closer rows, for long lists (logs, requests). */
  isCompact?: boolean;
  /** At most this many rows show at once, the next peeking in; the rest scroll under the header. Left out, rows show up to 40rem (640px at the browser's own text size) or three quarters of the screen. */
  shownRowCount?: number;
  /** In place of the rows while they come or can't: a Loading state or a Problem state, under the header. */
  rowsPlaceholder?: Raw;
  /** In place of the rows while there are none: an Empty state, under the header. */
  whenEmpty: Raw;
  /** Unique on the page. Defaults to a slug of its caption. */
  id?: string;
}

/**
 * A table on glass: a header row of clearer glass that stays while its rows scroll under it, hairlines between rows, numbers right-aligned in
 * figures of one width, and, when the first column names the rows, that column staying put as it scrolls sideways. On a phone it scrolls
 * sideways inside its pane, fading at its edges, under a caption that stays: a row never folds into a card, since developers compare rows.
 * Its box is cut by the edge rule, so its corners follow the pane's where it sits in one.
 */
export function table(options: TableOptions): Raw {
  const id = options.id ?? `table-${options.caption.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const cellClass = (columnIndex: number) => {
    const column = options.columns[columnIndex];
    const names = [column?.isNumeric && "num", column?.isLongText && "long", column?.isActions && "actions"].filter(Boolean).join(" ");
    return names ? html` class="${names}"` : "";
  };
  const isRowHead = (columnIndex: number) => options.hasRowHeads && columnIndex === 0;
  const cell = (given: Raw | string | TableCell, columnIndex: number) => {
    const content = typeof given === "object" && "detail" in given ? html`${given.text}<span class="table-cell-detail">${given.detail}</span>` : given;
    return isRowHead(columnIndex)
      ? html`<th scope="row" class="glass">${content}</th>`
      : html`<td${cellClass(columnIndex)}>${options.columns[columnIndex]?.isActions ? html`<div class="control-row">${content}</div>` : content}</td>`;
  };
  const placeholder = options.rowsPlaceholder ?? (options.rows.length ? null : options.whenEmpty);
  const body = placeholder
    ? html`<tr><td class="table-placeholder" colspan="${String(options.columns.length)}"><div class="table-placeholder-in">${placeholder}</div></td></tr>`
    : options.rows.map((row) => html`<tr>${row.map(cell)}</tr>`);
  const cap = options.shownRowCount ? html` style="--shown-row-count:${String(options.shownRowCount)}"` : "";
  return html`<div class="table"><p class="table-caption words-margin" id="${id}-caption">${options.caption}</p><div class="table-scroll${options.shownRowCount ? " is-capped" : ""}"${cap} data-fades-sideways data-side-rail${options.shownRowCount ? "" : raw(" data-scroll-box")} data-cut-line="8"><table class="data-table${options.isCompact ? " compact" : ""}${options.hasRowHeads ? " has-row-heads" : ""}" aria-labelledby="${id}-caption"><thead><tr>${options.columns.map(
    (column, columnIndex) => html`<th scope="col" class="glass${column.isNumeric ? " num" : ""}${column.isActions ? " actions" : ""}">${column.isActions ? html`<span><span class="sr">${column.label}</span></span>` : column.label}</th>`,
  )}</tr></thead><tbody class="hairlines">${body}</tbody></table></div></div>`;
}

const VERSION_COLUMNS: TableColumn[] = [{ label: "Version" }, { label: "State" }, { label: "Files", isNumeric: true }, { label: "Size", isNumeric: true }, { label: "Made" }];
const VERSION_ROWS: (Raw | string)[][] = [
  ["Version 15", VERSION_STATE_TAGS.held, "314", "49.2 MB", "An hour ago"],
  ["Version 14", VERSION_STATE_TAGS.live, "312", "48.1 MB", "Oct 19"],
  ["Version 13", VERSION_STATE_TAGS.replaced, "309", "47.6 MB", "Oct 16"],
  ["Version 12", VERSION_STATE_TAGS.replaced, "296", "45.3 MB", "Oct 11"],
];
const REQUEST_COLUMNS: TableColumn[] = [{ label: "When" }, { label: "Route" }, { label: "Status", isNumeric: true }, { label: "Took", isNumeric: true }];
const REQUEST_ROUTES = ["POST /match/start", "GET /leaderboard", "POST /match/end", "GET /inventory", "POST /trade", "GET /season/pass", "POST /party/invite"];
const REQUEST_ROWS: (Raw | string)[][] = Array.from({ length: 30 }, (_, rowIndex) => {
  const secondCount = 14 * 3600 + 2 * 60 + 11 - rowIndex * 17;
  const clock = [Math.floor(secondCount / 3600), Math.floor(secondCount / 60) % 60, secondCount % 60].map((clockPartNumber) => String(clockPartNumber).padStart(2, "0")).join(":");
  return [clock, html`<code>${REQUEST_ROUTES[rowIndex % REQUEST_ROUTES.length]}</code>`, rowIndex % 9 === 2 ? "409" : rowIndex % 11 === 4 ? "429" : "200", `${(rowIndex * 7) % 40 + 2} ms`];
});
const tablePane = (options: Omit<TableOptions, "whenEmpty">) => glassPane({ paneWidth: "full", body: table({ whenEmpty: emptyState({ title: "No rows yet", text: "Rows show here as they come." }), ...options }) });

component({
  name: "Table",
  slug: "table",
  group: "data",
  subgroup: "lists",
  summary: "Rows to compare: versions, requests, players, logs. Its header stays as the rows scroll under it, numbers line up on the right, and on a phone it scrolls sideways rather than folding rows into cards.",
  styles: `
/* A table: its caption in a label's words over a box that scrolls sideways under it, cut by the edge rule. Its header row is clearer glass
   that stays at the top while a long table's rows scroll under it, taking the glass's hue and light or dark as all glass does. A first
   column that names the rows stays at the left; it turns to denser glass only once the rest of the rows slide under it, and until then
   reads as part of its row. A row under the pointer brightens a little, its head too, like a list row. */
/* How tall its header and a row stand (a row holding a tag), for a capped table's height. */
/* A row's height is its padding and a line of its words, which grow with the browser's text size: 37px and 51px at the browser's own 16px, 33px and 34px compact. */
.table { display: grid; gap: var(--gap-words-control); min-width: 0; --table-head-height: calc(16px + 1.3125rem); --table-row-height: calc(28px + 1.4375rem); }
.table:has(.compact) { --table-head-height: calc(16px + 1.0625rem); --table-row-height: calc(16px + 1.125rem); }
.table-caption { margin: 0; font: var(--type-label); color: var(--ink); }
.table-scroll { position: relative; max-width: 100%; clip-path: var(--cut-shape); }
.table-scroll[data-fades-sideways] { overflow-y: auto; max-height: min(40rem, 75dvh); }
/* Capped: its rows down to the given count show, half the next peeking in under them. */
.table-scroll[data-fades-sideways].is-capped { max-height: calc(var(--table-head-height) + (var(--shown-row-count) + 0.5) * var(--table-row-height)); }
/* A capped table's rows fade out under its head and over its foot while there's more that way (SCROLL_FADE_SCRIPT, from its head's height,
   --fade-from), as well as at its sides: both masks at once. */
.table-scroll.is-capped.scroll-fades.is-fading {
  -webkit-mask-image: linear-gradient(90deg, transparent 0, rgba(0,0,0,0.22) calc(var(--fade-left) * 0.35), rgba(0,0,0,0.66) calc(var(--fade-left) * 0.7), #000 var(--fade-left), #000 calc(100% - var(--fade-right)), rgba(0,0,0,0.66) calc(100% - var(--fade-right) * 0.7), rgba(0,0,0,0.22) calc(100% - var(--fade-right) * 0.35), transparent 100%),
    linear-gradient(to bottom, #000 var(--fade-from, 0px), transparent var(--fade-from, 0px), #000 calc(var(--fade-from, 0px) + var(--fade-top)), #000 calc(100% - var(--fade-bottom)), transparent);
  mask-image: linear-gradient(90deg, transparent 0, rgba(0,0,0,0.22) calc(var(--fade-left) * 0.35), rgba(0,0,0,0.66) calc(var(--fade-left) * 0.7), #000 var(--fade-left), #000 calc(100% - var(--fade-right)), rgba(0,0,0,0.66) calc(100% - var(--fade-right) * 0.7), rgba(0,0,0,0.22) calc(100% - var(--fade-right) * 0.35), transparent 100%),
    linear-gradient(to bottom, #000 var(--fade-from, 0px), transparent var(--fade-from, 0px), #000 calc(var(--fade-from, 0px) + var(--fade-top)), #000 calc(100% - var(--fade-bottom)), transparent);
  -webkit-mask-composite: source-in; mask-composite: intersect; }
/* The rows' heads stay put as it scrolls sideways, so it never fades out under them. */
.table-scroll.more-left:has(> .has-row-heads) { --fade-left: 0px; }
.data-table { width: 100%; border-collapse: separate; border-spacing: 0; font: var(--type-words); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.data-table th, .data-table td { white-space: nowrap; text-align: left; }
.data-table thead th { position: sticky; top: 0; z-index: 2; padding: 10px var(--pad-inside-words); font: var(--type-facts); color: var(--muted);
  --glass-tint: var(--table-head); --glass-sheen: linear-gradient(transparent, transparent); box-shadow: inset 0 -1px 0 var(--line); }
.data-table td, .data-table tbody th { padding: 14px var(--pad-inside-words); }
.data-table tbody th { position: sticky; left: 0; z-index: 1; font: var(--type-label); color: var(--ink);
  --glass-tint: transparent; --glass-sheen: linear-gradient(transparent, transparent); }
.data-table.has-row-heads thead th:first-child { left: 0; z-index: 3; }
/* Once rows slide under the heads, the heads are clearer glass too, but denser, with a hairline at their edge: their words must win. */
.table-scroll.more-left .data-table tbody th { --glass-tint: var(--table-row-head); box-shadow: inset -1px 0 0 var(--line); }
.table-scroll.more-left .data-table.has-row-heads thead th:first-child { --glass-tint: var(--table-row-head); box-shadow: inset 0 -1px 0 var(--line), inset -1px 0 0 var(--line); }
.data-table td:first-child { color: var(--ink); }
.data-table code { font: var(--type-code); }
.data-table .num { text-align: right; }
.data-table td.long { white-space: normal; min-width: var(--size-card); }
/* A cell's second line: under its words, in the header's quieter ones. */
.data-table .table-cell-detail { display: block; font: var(--type-facts); color: var(--muted); }
/* A row's buttons: at its end, as narrow as they are, and no taller than its words' room, so a row with buttons is no taller than one without. */
.data-table .actions { width: 1%; }
.data-table td.actions { padding-block: 0; }
.data-table.compact thead th { padding: 8px var(--pad-inside-words); }
.data-table.compact td, .data-table.compact tbody th { padding: 8px var(--pad-inside-words); font: var(--type-facts); }
/* In place of rows: a loading, empty or problem state, kept in view under the header however wide the table is. */
.table-scroll:has(.table-placeholder) { container-type: inline-size; }
.data-table td.table-placeholder { padding: 0; white-space: normal; }
.table-placeholder-in { position: sticky; left: 0; width: 100cqi; }
`,
  render: table,
  examples: [
    { label: "Versions", isWide: true, markup: tablePane({ caption: "Versions", hasRowHeads: true, columns: VERSION_COLUMNS, rows: VERSION_ROWS }) },
    {
      label: "A button a row",
      isWide: true,
      markup: tablePane({
        caption: "Versions to publish",
        hasRowHeads: true,
        columns: [...VERSION_COLUMNS.slice(0, 2), { label: "Size", isNumeric: true }, { label: "Made" }, { label: "Actions", isActions: true }],
        rows: [
          ["Version 16", VERSION_STATE_TAGS.passed, "49.4 MB", "10 min ago", secondaryButton("Publish", ROW_BUTTON)],
          ["Version 15", VERSION_STATE_TAGS.held, "49.2 MB", "An hour ago", secondaryButton("Details", ROW_BUTTON)],
          ["Version 13", VERSION_STATE_TAGS.replaced, "47.6 MB", "Oct 16", secondaryButton("Roll back", ROW_BUTTON)],
        ],
      }),
    },
    {
      label: "A second line in a cell, and a button only in the rows that have one",
      isWide: true,
      markup: tablePane({
        caption: "Credit entries",
        isCompact: true,
        columns: [{ label: "Day" }, { label: "What" }, { label: "Game" }, { label: "Amount", isNumeric: true }, { label: "Refund", isActions: true }],
        rows: [
          ["Oct 26", { text: "Credit added", detail: "$25 refundable until Nov 25" }, "", "+$25", secondaryButton("Refund", ROW_BUTTON)],
          ["Oct 25", "Hosting", "ashen-crown", "−$4.10", ""],
          ["Sep 30", "Credit added", "", "+$25", ""],
        ],
      }),
    },
    {
      label: "Long cells wrap",
      isWide: true,
      markup: tablePane({
        caption: "What the scan found",
        columns: [{ label: "File" }, { label: "Found", isLongText: true }],
        rows: [
          [html`<code>build/scripts/vendor/analytics-loader.min.js</code>`, "Loads a script from another site, cdn.adnetwork-example.net. Download it into your build, or list the site in game_server_allowed_hosts."],
          [html`<code>assets/audio/ambience/forest_night_loop_02.ogg</code>`, "Larger than 50 MB. Players on a slow connection wait for it before the game starts."],
        ],
      }),
    },
    {
      label: "Compact and capped: rows scroll under the header",
      isWide: true,
      markup: tablePane({ caption: "Requests to your game server", isCompact: true, shownRowCount: 6, columns: REQUEST_COLUMNS, rows: REQUEST_ROWS }),
    },
    { label: "Loading, in place of its rows", isWide: true, markup: tablePane({ caption: "Versions", hasRowHeads: true, columns: VERSION_COLUMNS, rows: [], rowsPlaceholder: loadingState({ label: "Getting your versions" }) }) },
    {
      label: "Empty, in place of its rows",
      isWide: true,
      markup: tablePane({ caption: "Versions", hasRowHeads: true, columns: VERSION_COLUMNS, rows: [], rowsPlaceholder: emptyState({ title: "No versions yet", text: "Upload a folder with an index.html from your terminal, or from your AI." }) }),
    },
  ],
});

export interface NumberItem {
  label: string;
  /** The figure as it reads, already formatted: "1,284", "12.4". */
  figure: string;
  /** After the figure, smaller: "hours", "MB". */
  unit?: string;
  /** How it moved, in words: "+18% on last week". */
  change?: string;
  /** The change is good news (more players): it's green. Otherwise it stays quiet. */
  isChangeGood?: boolean;
}

/** Numbers: a row of figures in Jost, each with its label under it and how it moved. */
export function numbers(options: { items: NumberItem[] }): Raw {
  return html`<dl class="numbers words-margin">${options.items.map(
    (numberItem) => html`<div class="number"><dt>${numberItem.label}</dt><dd class="number-figure"><span class="number-amount">${numberItem.figure}</span>${numberItem.unit ? html`<span class="number-unit">${numberItem.unit}</span>` : ""}</dd>${numberItem.change ? html`<dd class="number-change${numberItem.isChangeGood ? " good" : ""}">${numberItem.change}</dd>` : ""}</div>`,
  )}</dl>`;
}

component({
  name: "Numbers",
  slug: "numbers",
  group: "data",
  subgroup: "numbers",
  summary: "A row of figures to take in at a glance: players, hours, plays. Each figure is big, its label sits under it, and how it moved is green when it's good news.",
  styles: `
/* Numbers: big figures in Jost with figures of one width, their unit smaller beside them (under them when there's no room), the label under
   each in facts. They share the row, each at least --size-number wide, two to a line on a phone. A figure never breaks: a long one (the
   millions) takes a wider place, and the others go on to the next line. */
.numbers { display: flex; flex-wrap: wrap; gap: var(--gap-block-block); margin: 0; }
.number { flex: 1 1 var(--size-number); min-width: min-content; display: grid; gap: var(--gap-words-words); align-content: start; }
.number dt { order: 2; font: var(--type-facts); color: var(--muted); }
.number dd { margin: 0; }
.number-figure { order: 1; display: flex; flex-wrap: wrap; align-items: baseline; column-gap: var(--gap-words-words); }
.number-amount { font: var(--type-heading); color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.number-unit { font: var(--type-label); color: var(--ink-2); }
.number-change { order: 3; font: var(--type-facts); color: var(--ink-2); }
.number-change.good { color: var(--tag-new-ink); }
`,
  render: numbers,
  examples: [
    {
      label: "This week",
      isWide: true,
      markup: glassPane({ paneWidth: "full", body: numbers({ items: [
        { label: "Players", figure: "1,284", change: "+18% on last week", isChangeGood: true },
        { label: "Hours played", figure: "3,906", unit: "hours", change: "+6% on last week", isChangeGood: true },
        { label: "Plays", figure: "9,412", change: "−3% on last week" },
        { label: "Stored", figure: "48.1", unit: "MB" },
      ] }) }),
    },
    {
      label: "In the millions",
      isWide: true,
      markup: glassPane({ paneWidth: "full", body: numbers({ items: [
        { label: "Players all time", figure: "12,480,915", change: "+4% on last month", isChangeGood: true },
        { label: "Hours played", figure: "1,906,442", unit: "hours", change: "+9% on last month", isChangeGood: true },
        { label: "Plays", figure: "38,204,117" },
        { label: "Stored", figure: "4.8", unit: "GB" },
      ] }) }),
    },
  ],
});

export interface ChartPoint {
  /** What the point is, said under the chart and to screen readers: "Oct 14", or a share's name: "Chrome". */
  label: string;
  amountNumber: number;
}

export interface ChartOptions {
  /** What it shows: "Plays a day". */
  label: string;
  /** None yet: it says so ("No plays yet."), in a plot's room. */
  points: ChartPoint[];
  /** What the numbers count, said with each one: "plays". */
  unit: string;
  /** A line over time (the default), bars over time, one a point, or a ring of shares of a whole. */
  chartKind?: "line" | "bars" | "ring";
  /** The gallery's fixed state: the point at this place in points is pointed at, showing its dot and its number. */
  pointedIndex?: number;
}

/** The top of a chart's scale: the smallest round number at or over the biggest point, so its grid reads in round steps. */
function chartTopNumber(biggestNumber: number): number {
  if (biggestNumber <= 0) return 1;
  const stepNumber = 10 ** Math.floor(Math.log10(biggestNumber));
  for (const timesNumber of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (timesNumber * stepNumber >= biggestNumber) return timesNumber * stepNumber;
  return 10 * stepNumber;
}
const chartWords = (amountNumber: number) => amountNumber.toLocaleString("en-US", { maximumFractionDigits: 1 });
/** A scale's numbers, short from ten thousand up (12K, 1.5M), so the scale's column stays narrow. */
const scaleWords = (amountNumber: number) => (amountNumber >= 10000 ? amountNumber.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 }) : chartWords(amountNumber));
/** Bars keep at least a seventh of the width each: a few bars stand side by side in the middle, so one bar is never a slab. */
const LEAST_BAR_SLOT_COUNT = 7;

/**
 * A chart, drawn here as SVG, so there's nothing to wait for. Over time, a line or bars on a hairline grid in round steps, its numbers in a
 * column of their own at the left so nothing drawn crosses them, the line (or bars) in ink and the last point marked with its number.
 * Pointing at a point shows its number, and so does tabbing to the chart and stepping along its points with the arrow keys. On a narrow
 * screen every point keeps its room and the chart scrolls sideways, starting at the latest. A table with the same numbers sits behind it
 * for screen readers (in a hidden box: a table never shrinks to one), so the drawing is hidden from them.
 * A ring shows shares of a whole: each share a part of the ring, the biggest darkest, with a key of names, shares and numbers beside it.
 */
export function chart(options: ChartOptions): Raw {
  if (options.points.length === 0) return html`<figure class="chart words-margin"><figcaption class="chart-label">${options.label}</figcaption><p class="chart-empty">No ${options.unit} yet.</p></figure>`;
  if (options.chartKind === "ring") return ringChart(options);
  const widthNumber = 1000, heightNumber = 300, points = options.points, pointCount = points.length;
  const topNumber = chartTopNumber(Math.max(...points.map((point) => point.amountNumber), 0));
  const isBars = options.chartKind === "bars";
  const slotNumber = widthNumber / Math.max(pointCount, LEAST_BAR_SLOT_COUNT);
  const barsStartNumber = (widthNumber - slotNumber * pointCount) / 2;
  const barLeftNumber = (pointIndex: number) => barsStartNumber + slotNumber * (pointIndex + 0.18);
  const barWidthNumber = slotNumber * 0.64;
  const acrossNumber = (pointIndex: number) => (isBars ? barsStartNumber + slotNumber * (pointIndex + 0.5) : pointCount > 1 ? (pointIndex / (pointCount - 1)) * widthNumber : widthNumber / 2);
  const downNumber = (amountNumber: number) => heightNumber - (amountNumber / topNumber) * heightNumber;
  const percent = (acrossOrDownNumber: number, wholeNumber: number) => ((acrossOrDownNumber / wholeNumber) * 100).toFixed(2);
  const downPct = (amountNumber: number) => percent(downNumber(amountNumber), heightNumber);
  const line = points.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${acrossNumber(pointIndex).toFixed(1)} ${downNumber(point.amountNumber).toFixed(1)}`).join(" ");
  const drawing = isBars
    ? points.map((point, pointIndex) => {
        const barHeightNumber = Math.max(heightNumber - downNumber(point.amountNumber), 1);
        return raw(`<rect class="chart-bar${pointIndex === pointCount - 1 ? " last" : ""}" x="${barLeftNumber(pointIndex).toFixed(1)}" y="${(heightNumber - barHeightNumber).toFixed(1)}" width="${barWidthNumber.toFixed(1)}" height="${barHeightNumber.toFixed(1)}"/>`);
      })
    : raw(`<path class="chart-line" d="${line}" vector-effect="non-scaling-stroke"/>`);
  const area = isBars || pointCount < 2 ? "" : raw(`<svg class="chart-drawing chart-area-drawing" viewBox="0 0 ${widthNumber} ${heightNumber}" preserveAspectRatio="none"><path class="chart-area" d="${line} L${acrossNumber(pointCount - 1).toFixed(1)} ${heightNumber} L${acrossNumber(0).toFixed(1)} ${heightNumber} Z"/></svg>`);
  const last = points[pointCount - 1]!;
  // The last point's number: over a line's last dot, ending at it; over the last bar, centered on it, or ending at its right edge when
  // wider than it, so it never reaches past the plot's end.
  const lastMark = isBars
    ? html`<span class="chart-last is-bar" style="left:${percent(barLeftNumber(pointCount - 1), widthNumber)}%;width:${percent(barWidthNumber, widthNumber)}%;top:${downPct(last.amountNumber)}%"><span class="chart-last-words">${chartWords(last.amountNumber)}</span></span>`
    : html`<span class="chart-last${pointCount === 1 ? " is-alone" : ""}" style="left:${percent(acrossNumber(pointCount - 1), widthNumber)}%;top:${downPct(last.amountNumber)}%"><span class="chart-last-words">${chartWords(last.amountNumber)}</span></span>`;
  // Where the pointer finds each point: a column round it, as wide as the room between points (a bar's slot), holding its dot and its number.
  // The first and last stop at the plot's ends, so nothing reaches past it to make it scroll.
  const hitWidthPct = isBars ? (slotNumber / widthNumber) * 100 : 100 / Math.max(pointCount - 1, 1);
  const hits = points.map((point, pointIndex) => {
    // Its number opens toward the middle of the chart, so it stays inside it: a line's from its point, a bar's centered on it but for the
    // first and last, which line up with their bar's outer edge. Near the top, it opens below the point, so it's never cut off there.
    const place = isBars ? (pointIndex === 0 ? " is-start" : pointIndex === pointCount - 1 ? " is-end" : " is-middle") : pointIndex >= pointCount / 2 ? " is-end" : "";
    const height = downNumber(point.amountNumber) / heightNumber < 0.35 ? " is-high" : "";
    const pointed = pointIndex === options.pointedIndex ? " is-pointed" : "";
    const centerPct = (acrossNumber(pointIndex) / widthNumber) * 100, leftPct = Math.max(0, centerPct - hitWidthPct / 2), rightPct = Math.min(100, centerPct + hitWidthPct / 2);
    return html`<span class="chart-hit${place}${height}${pointed}" style="left:${leftPct.toFixed(2)}%;width:${(rightPct - leftPct).toFixed(2)}%;--point-left:${(((centerPct - leftPct) / Math.max(rightPct - leftPct, 0.01)) * 100).toFixed(2)}%;--point-top:${downPct(point.amountNumber)}%"><span class="chart-dot"></span><span class="chart-tip"><b>${chartWords(point.amountNumber)} ${options.unit}</b><span>${point.label}</span></span></span>`;
  });
  // Under the plot, the first and last points' labels: at a line's ends; under a few bars, centered on them (the first only when there's room
  // beside the last); under many, at the bars' outer edges.
  const centeredLabel = (pointIndex: number) => html`<span class="is-middle" style="left:${percent(acrossNumber(pointIndex), widthNumber)}%">${points[pointIndex]!.label}</span>`;
  const axis =
    pointCount === 1
      ? centeredLabel(0)
      : !isBars
        ? html`<span style="left:0%">${points[0]!.label}</span><span class="is-end" style="right:0%">${last.label}</span>`
        : pointCount >= LEAST_BAR_SLOT_COUNT
          ? html`<span style="left:${percent(barLeftNumber(0), widthNumber)}%">${points[0]!.label}</span><span class="is-end" style="right:${percent(widthNumber - barLeftNumber(pointCount - 1) - barWidthNumber, widthNumber)}%">${last.label}</span>`
          : html`${pointCount >= 3 ? centeredLabel(0) : ""}${centeredLabel(pointCount - 1)}`;
  const grid = [1, 0.5, 0];
  return html`<figure class="chart words-margin" tabindex="0" data-chart-points><figcaption class="chart-label">${options.label}</figcaption><div class="chart-body" aria-hidden="true"><div class="chart-scale">${grid.map(
    (shareNumber) => html`<span style="top:${((1 - shareNumber) * 100).toFixed(0)}%">${scaleWords(topNumber * shareNumber)}</span>`,
  )}</div><div class="chart-scroll" data-fades-sideways data-side-rail data-chart-scroll><div class="chart-inner${isBars ? " is-bars" : ""}" style="--point-count:${pointCount}"><div class="chart-plot">${grid.map(
    (shareNumber) => html`<span class="chart-grid" style="top:${((1 - shareNumber) * 100).toFixed(0)}%"></span>`,
  )}${area}<svg class="chart-drawing" viewBox="0 0 ${widthNumber} ${heightNumber}" preserveAspectRatio="none">${drawing}</svg>${lastMark}${hits}</div><div class="chart-axis">${axis}</div></div></div></div><div class="sr"><table><caption>${options.label}</caption><tbody>${points.map(
    (point) => html`<tr><th scope="row">${point.label}</th><td>${chartWords(point.amountNumber)} ${options.unit}</td></tr>`,
  )}</tbody></table></div></figure>`;
}

/** A ring of shares: each share a part of the ring, clockwise from the top, biggest first; its key names each with its share and number. */
function ringChart(options: ChartOptions): Raw {
  const shares = [...options.points].sort((one, other) => other.amountNumber - one.amountNumber);
  const totalNumber = shares.reduce((sumNumber, point) => sumNumber + point.amountNumber, 0) || 1;
  const radiusNumber = 48, roundNumber = 2 * Math.PI * radiusNumber, gapNumber = shares.length > 1 ? 1.6 : 0;
  let startNumber = 0;
  const parts = shares.map((point, shareIndex) => {
    const lengthNumber = (point.amountNumber / totalNumber) * roundNumber;
    const part = raw(`<circle class="ring-part" data-share="${shareIndex}" cx="60" cy="60" r="${radiusNumber}" stroke-dasharray="${Math.max(lengthNumber - gapNumber, 0.1).toFixed(2)} ${roundNumber.toFixed(2)}" stroke-dashoffset="${(-startNumber).toFixed(2)}" transform="rotate(-90 60 60)"/>`);
    startNumber += lengthNumber;
    return part;
  });
  const sharePct = (point: ChartPoint) => Math.round((point.amountNumber / totalNumber) * 100);
  return html`<figure class="chart ring words-margin"><figcaption class="chart-label">${options.label}</figcaption><div class="ring-body"><div class="ring-picture"><svg class="ring-drawing" viewBox="0 0 120 120" aria-hidden="true">${parts}</svg><span class="ring-total"><b>${chartWords(totalNumber)}</b>${options.unit}</span></div><ul class="ring-key hairlines">${shares.map(
    (point, shareIndex) => html`<li class="flush-row quiet" data-share="${shareIndex}"><span class="ring-swatch" aria-hidden="true"></span><span class="ring-name">${point.label}</span><span class="ring-share">${sharePct(point)}%</span><span class="ring-amount">${chartWords(point.amountNumber)} ${options.unit}</span></li>`,
  )}</ul></div></figure>`;
}

/**
 * A chart that scrolls sideways starts at its latest points. The chart itself is one tab stop: focused from the keyboard, its latest point
 * shows its number, and the arrow keys, Home and End step along its points, scrolling each into view. Screen readers read its table instead.
 */
export const CHART_SCRIPT = `/* charts */(function () {
  document.querySelectorAll("[data-chart-scroll]").forEach(function (scroll) { scroll.scrollLeft = scroll.scrollWidth; });
  function focusPoint(chart, hits, to) {
    hits.forEach(function (hit, hitIndex) { hit.classList.toggle("is-focused", hitIndex === to); });
    var scroll = chart.querySelector("[data-chart-scroll]"), hit = hits[to];
    if (!scroll || !hit) return;
    var box = scroll.getBoundingClientRect(), place = hit.getBoundingClientRect();
    if (place.left < box.left) scroll.scrollLeft -= box.left - place.left;
    else if (place.right > box.right) scroll.scrollLeft += place.right - box.right;
  }
  function pointsOf(chart) { return Array.prototype.slice.call(chart.querySelectorAll(".chart-hit")); }
  document.addEventListener("focusin", function (event) {
    var chart = event.target instanceof Element && event.target.matches("[data-chart-points]") ? event.target : null; if (!chart) return;
    var hits = pointsOf(chart);
    if (hits.length && !chart.querySelector(".chart-hit.is-focused")) focusPoint(chart, hits, hits.length - 1);
  });
  document.addEventListener("keydown", function (event) {
    var chart = event.target instanceof Element && event.target.matches("[data-chart-points]") ? event.target : null; if (!chart) return;
    var hits = pointsOf(chart), at = hits.indexOf(chart.querySelector(".chart-hit.is-focused")), to = at;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") to = Math.min(hits.length - 1, at + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = Math.max(0, at - 1);
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = hits.length - 1;
    else return;
    event.preventDefault();
    focusPoint(chart, hits, to);
  });
})();
`;

const DAILY_PLAYS: ChartPoint[] = [812, 904, 870, 1012, 1190, 1460, 1384, 1102, 1056, 1218, 1305, 1520, 1712, 1655].map((amountNumber, dayIndex) => ({ label: `Oct ${8 + dayIndex}`, amountNumber }));
const MONTHLY_PLAYERS: ChartPoint[] = [3120, 3480, 4210, 3990, 4620, 5310, 6870, 7420, 6980, 8130, 9760, 11240, 12480, 11920, 13650, 15210, 16880, 18420, 17950, 21300, 23870, 26420, 25110, 28940].map((amountNumber, weekIndex) => ({ label: `Week ${weekIndex + 1}`, amountNumber }));
const SHARE_RING_CSS = [0, 1, 2, 3, 4, 5, 6, 7]
  .map((shareIndex) => `.ring:has(.ring-key [data-share="${shareIndex}"]:hover) .ring-part[data-share="${shareIndex}"], .ring:has(.ring-part[data-share="${shareIndex}"]:hover) .ring-part[data-share="${shareIndex}"] { stroke: var(--ink); }
.ring:has(.ring-part[data-share="${shareIndex}"]:hover) .ring-key [data-share="${shareIndex}"] { --face-color: var(--row-hover); }`)
  .join("\n");
const chartPane = (options: ChartOptions) => glassPane({ paneWidth: "full", body: chart(options) });

component({
  name: "Chart",
  slug: "chart",
  group: "data",
  subgroup: "numbers",
  summary: "How something moved over time, drawn on the page with nothing to wait for: a line or bars on a hairline grid, the last point marked with its number, and any point's number where you point or step with the arrow keys. Or how a whole splits, as a ring with its key. Screen readers get the same numbers.",
  styles: `
/* A chart over time: its label, then its scale's numbers in a column of their own and the plot beside it, the first and last points' labels
   under the plot. The drawing stretches to the plot while its line keeps its 2px. On a narrow screen each point keeps at least its room
   (--point-room) and the plot scrolls sideways under a scale that stays. The last point is an ink dot with its number over it; pointing at
   any point, or focusing it, shows its dot and its number (a bar's column brightens), its words kept inside the plot at the ends. */
.chart { display: grid; gap: var(--gap-block-block); margin: 0; min-width: 0; }
.chart-label { font: var(--type-label); color: var(--ink); }
.chart-body { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--gap-words-control); }
.chart-scale { position: relative; height: 180px; min-width: 32px; font: var(--type-facts); color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
.chart-scale > span { position: absolute; right: 0; transform: translateY(-50%); white-space: nowrap; }
.chart-scroll { min-width: 0; padding-top: var(--gap-block-block); margin-top: calc(-1 * var(--gap-block-block)); }
/* Its dots at the ends keep their whole round inside its padding; anything else past its sides is clipped, never making it scroll. */
.chart-inner { display: grid; row-gap: var(--gap-words-control); --point-room: 12px; min-width: calc(var(--point-count) * var(--point-room)); padding: 0 6px; overflow-x: clip; }
.chart-inner.is-bars { --point-room: 26px; }
.chart-plot { position: relative; height: 180px; }
.chart-grid { position: absolute; left: 0; right: 0; height: 0; border-top: var(--divider); }
.chart-drawing { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.chart-line { fill: none; stroke: var(--ink); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart-area { fill: var(--chart-fill); stroke: none; }
/* The shade under a line fades out at its ends and toward its foot, so it never stops in a hard edge. */
.chart-area-drawing { -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent), linear-gradient(#000 40%, transparent);
  -webkit-mask-composite: source-in; mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent), linear-gradient(#000 40%, transparent); mask-composite: intersect; }
.chart-bar { fill: var(--chart-bar); }
.chart-bar.last { fill: var(--ink-2); }
.chart-last { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; background: var(--ink); border-radius: 50%; box-shadow: 0 0 0 3px var(--chart-ring); pointer-events: none; }
.chart-last-words { position: absolute; right: 0; bottom: 14px; font: var(--type-label); color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; transition: opacity var(--motion-state); }
.chart-last.is-alone .chart-last-words { right: auto; left: 50%; transform: translateX(-50%); }
/* Over the last bar it spans the bar: its number centered on it, or ending at its right edge when wider. */
.chart-last.is-bar { height: 0; margin: 0; background: none; border-radius: 0; box-shadow: none; }
.chart-last.is-bar .chart-last-words { bottom: 6px; min-width: 100%; text-align: center; }
.chart-body > .rail { grid-column: 2; }
.chart-axis { display: grid; font: var(--type-facts); color: var(--muted); }
.chart-axis > span { grid-area: 1 / 1; justify-self: start; position: relative; white-space: nowrap; }
.chart-axis > .is-end { justify-self: end; }
.chart-axis > .is-middle { transform: translateX(-50%); }
.chart-hit { position: absolute; top: 0; bottom: 0; z-index: 2; }
/* Focused from the keyboard, the chart shows its focused point as pointed at, ringed in the focus color. */
.chart:focus-visible { outline: none; }
.chart-inner.is-bars .chart-hit:is(:hover, .is-pointed), .chart:focus-visible .chart-inner.is-bars .chart-hit.is-focused { background: var(--row-hover); }
.chart:focus-visible .chart-inner.is-bars .chart-hit.is-focused { outline: 2px solid var(--focus); outline-offset: -2px; }
.chart-dot { position: absolute; left: var(--point-left); top: var(--point-top); width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--ink); box-shadow: 0 0 0 3px var(--chart-ring); opacity: 0; transition: opacity var(--motion-state); }
.chart:focus-visible .chart-hit.is-focused .chart-dot { outline: 2px solid var(--focus); outline-offset: 3px; }
.chart-inner.is-bars .chart-dot { display: none; }
.chart-tip { position: absolute; left: var(--point-left); bottom: calc(100% - var(--point-top) + 12px); transform: translateX(-12px); display: grid; padding: 4px 8px; white-space: nowrap;
  font: var(--type-facts); color: var(--ink-2); background: var(--chart-tip); box-shadow: var(--slab-shade); opacity: 0; transition: opacity var(--motion-state); pointer-events: none; }
.chart-tip b { font-weight: 600; color: var(--ink); }
.chart-hit.is-end .chart-tip { transform: translateX(calc(-100% + 12px)); }
.chart-hit.is-high .chart-tip { bottom: auto; top: calc(var(--point-top) + 12px); }
.chart-inner.is-bars .chart-hit.is-middle .chart-tip { transform: translateX(-50%); }
.chart-inner.is-bars .chart-hit.is-start .chart-tip { left: 0; transform: none; }
.chart-inner.is-bars .chart-hit.is-end .chart-tip { left: auto; right: 0; transform: none; }
.chart-hit:is(:hover, .is-pointed) :is(.chart-dot, .chart-tip), .chart:focus-visible .chart-hit.is-focused :is(.chart-dot, .chart-tip) { opacity: 1; }
/* While any point's number shows, the last point's steps aside, so the two never meet. */
.chart-plot:has(.chart-hit:is(:hover, .is-pointed)) .chart-last-words, .chart:focus-visible .chart-plot:has(.chart-hit.is-focused) .chart-last-words { opacity: 0; }
/* No points yet: it says so where the plot would be, over the plot's foot line. */
.chart-empty { display: grid; place-items: center; height: 180px; border-bottom: var(--divider); font: var(--type-words); color: var(--muted); }
/* A ring: the shares round a ring, biggest first and darkest, each lighter after; the whole in its middle. Its key beside it (under it on a
   phone), no wider than a card so each name reads with its share, names each with its share and number. Pointing at a part or its line in
   the key draws that part in ink and brightens its line. */
.ring-body { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--gap-block-block); }
.ring-picture { position: relative; flex: none; width: 168px; height: 168px; }
.ring-drawing { width: 100%; height: 100%; }
.ring-part { fill: none; stroke-width: 16; stroke: var(--share-color); transition: stroke var(--motion-state); cursor: default; }
.ring-total { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; font: var(--type-facts); color: var(--muted); }
.ring-total b { font: var(--type-section); color: var(--ink); font-variant-numeric: tabular-nums; }
.ring-key { flex: 0 1 var(--size-card); list-style: none; margin: 0; padding: 0; display: grid; }
.ring-key li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: var(--gap-words-control); --row-height: 0px; --row-block: var(--gap-words-words); --row-start: var(--gap-words-words); --row-end: var(--gap-words-words); cursor: default; font: var(--type-words); color: var(--ink); }
.ring-key li:hover { --face-color: var(--row-hover); }
.ring-swatch { width: 12px; height: 12px; background: var(--share-color); }
.ring-share { font-weight: 600; font-variant-numeric: tabular-nums; }
.ring-name { overflow-wrap: break-word; }
.ring-amount { font: var(--type-facts); color: var(--muted); font-variant-numeric: tabular-nums; }
.ring [data-share="0"] { --share-color: color-mix(in srgb, var(--ink) 86%, transparent); }
.ring [data-share="1"] { --share-color: color-mix(in srgb, var(--ink) 62%, transparent); }
.ring [data-share="2"] { --share-color: color-mix(in srgb, var(--ink) 44%, transparent); }
.ring [data-share="3"] { --share-color: color-mix(in srgb, var(--ink) 30%, transparent); }
.ring [data-share="4"] { --share-color: color-mix(in srgb, var(--ink) 20%, transparent); }
.ring [data-share="5"], .ring [data-share="6"], .ring [data-share="7"] { --share-color: color-mix(in srgb, var(--ink) 12%, transparent); }
${SHARE_RING_CSS}
`,
  render: chart,
  examples: [
    { label: "A line: plays a day", isWide: true, markup: chartPane({ label: "Plays a day", points: DAILY_PLAYS, unit: "plays" }) },
    { label: "Bars: players a day", isWide: true, markup: chartPane({ label: "Players a day", points: DAILY_PLAYS.map((point) => ({ label: point.label, amountNumber: Math.round(point.amountNumber * 0.31) })), unit: "players", chartKind: "bars" }) },
    { label: "Many points: on a phone, it scrolls sideways from the latest", isWide: true, markup: chartPane({ label: "Players a week", points: MONTHLY_PLAYERS, unit: "players", chartKind: "bars" }) },
    { label: "Pointed", isWide: true, isStill: true, markup: chartPane({ label: "Plays a day", points: DAILY_PLAYS, unit: "plays", pointedIndex: 5 }) },
    { label: "One point: the first day", markup: chartPane({ label: "Plays a day", points: [{ label: "Oct 21", amountNumber: 214 }], unit: "plays" }) },
    { label: "Three bars", markup: chartPane({ label: "Players a day", points: [{ label: "Oct 19", amountNumber: 96 }, { label: "Oct 20", amountNumber: 188 }, { label: "Oct 21", amountNumber: 241 }], unit: "players", chartKind: "bars" }) },
    { label: "None yet", markup: chartPane({ label: "Plays a day", points: [], unit: "plays" }) },
    {
      label: "A ring: how a whole splits",
      isWide: true,
      markup: chartPane({ label: "Players by browser", unit: "players", chartKind: "ring", points: [
        { label: "Chrome", amountNumber: 6120 }, { label: "Safari", amountNumber: 3480 }, { label: "Edge", amountNumber: 1210 }, { label: "Firefox", amountNumber: 860 }, { label: "Others", amountNumber: 330 },
      ] }),
    },
  ],
});

export interface UsageMeterOptions {
  label: string;
  usedNumber: number;
  limitNumber: number;
  /** What's counted, after the numbers: "player-hours", "MB". */
  unit: string;
  /** The day it starts again from nothing, "YYYY-MM-DD" in UTC: said after the numbers as "Resets Nov 1." */
  resetDate?: string;
  /** The numbers said in words of the page's own instead ("62% of this month's free hosting"), for a meter whose figures are a share or two allowances in one. */
  shownWords?: string;
  /** Red from this number up, where that isn't 80% of the limit (a free allowance then a budget on one track). */
  warnFromNumber?: number;
  /** Used up isn't a warning: the track fills but isn't striped, and says nothing is wrong (a free allowance a budget carries on from). */
  isFullFine?: boolean;
  /** What used it: the fill in a color for each part, its share of the fill, and a key under the track naming each with its share. */
  parts?: UsagePart[];
}

/** One part of what used a meter: its name, its share of the use in whole percent, and its color (0 to 5), the same for the same thing everywhere. */
export interface UsagePart {
  label: string;
  sharePct: number;
  partColorIndex: number;
}

/** How full a meter is, and its tone: red from its warning point, striped when all used. */
function meterState(options: UsageMeterOptions) {
  const sharePct = Math.min(100, (options.usedNumber / Math.max(options.limitNumber, 1)) * 100);
  const isAllUsed = options.usedNumber >= options.limitNumber && !options.isFullFine;
  const warnFromPct = options.warnFromNumber === undefined ? 80 : (options.warnFromNumber / Math.max(options.limitNumber, 1)) * 100;
  const tone = isAllUsed ? " is-full" : sharePct >= warnFromPct ? " is-near" : options.usedNumber > 0 ? " is-used" : "";
  return { sharePct, isAllUsed, tone };
}

/** A meter's track alone, in its tone, and its parts' key, for a list row (or an old page's own plate) whose lines say its numbers. */
export function usageTrack(options: UsageMeterOptions): Raw {
  const { sharePct, tone } = meterState(options);
  return html`<span class="usage${tone}">${meterTrack(options, sharePct)}${usageKey(options)}</span>`;
}

function meterTrack(options: UsageMeterOptions, sharePct: number): Raw {
  const parts = options.parts?.filter((part) => part.sharePct > 0) ?? [];
  const lightMarkup = parts.length ? html`<span class="usage-parts">${parts.map((part) => html`<span class="usage-part" data-part="${String(part.partColorIndex)}" style="flex-grow:${String(part.sharePct)}"></span>`)}</span>` : undefined;
  return html`<div class="usage-track" role="meter" aria-label="${options.label}" aria-valuemin="0" aria-valuemax="${options.limitNumber}" aria-valuenow="${Math.min(options.usedNumber, options.limitNumber)}">${groove({ kind: `usage-groove${parts.length ? " has-parts" : ""}`, filledPct: sharePct, lightMarkup })}</div>`;
}

/** The key under a meter with parts: each part's color, name and share, in the order given. */
function usageKey(options: UsageMeterOptions): Raw | "" {
  const parts = options.parts?.filter((part) => part.sharePct > 0) ?? [];
  if (!parts.length) return "";
  return html`<ul class="usage-key words-margin" aria-label="What used ${options.label}">${parts.map((part) => html`<li data-part="${String(part.partColorIndex)}"><span class="usage-swatch" aria-hidden="true"></span>${part.label}<b>${String(part.sharePct)}%</b></li>`)}</ul>`;
}

/**
 * A usage meter: its label, its numbers under it, then a Groove filling in its orange light, red from 80%. Any use at all shows as a
 * sliver, never as an empty track. All used, it's unmistakable: the fill is striped red across the whole track, a warning mark leads its
 * label, and its numbers end in "all used", or in how far over it is.
 */
export function usageMeter(options: UsageMeterOptions): Raw {
  const { sharePct, isAllUsed, tone } = meterState(options);
  const overNumber = options.usedNumber - options.limitNumber;
  const allUsedWords = overNumber > 0 ? `, ${chartWords(overNumber)} ${options.unit} over` : ", all used";
  const resetWords = options.resetDate ? `Resets ${new Date(`${options.resetDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.` : "";
  return html`<div class="usage${tone}"><span class="usage-label words-margin">${isAllUsed ? icon("warning") : ""}${options.label}</span><p class="usage-numbers words-margin"><span class="usage-fact">${options.shownWords ?? html`${chartWords(options.usedNumber)} of ${chartWords(options.limitNumber)}\u00a0${options.unit}`}${isAllUsed ? html`<b>${allUsedWords}</b>` : ""}${resetWords ? "\u00a0·" : ""}</span>${resetWords ? html` <span class="usage-fact">${resetWords}</span>` : ""}</p>${usageKey(options)}${meterTrack(options, sharePct)}</div>`;
}

const meterPane = (options: UsageMeterOptions) => glassPane({ paneWidth: "fit", body: usageMeter(options) });

component({
  name: "Usage meter",
  slug: "usage-meter",
  group: "data",
  subgroup: "numbers",
  summary: "How much of an allowance is used: player-hours, requests, storage. A Groove fills in its orange light, turns red from 80%, and says so when it's all used, or over.",
  styles: `
/* A usage meter: its label on a line of its own, its numbers (and when it resets) under it, the track under them: a Groove (panes.ts), its
   light the Groove's own orange, red from 80%, the warning growing hotter as it fills; any use at all shows at least a sliver. All used,
   it's red striped with a deeper red, like tape across a door, a warning mark leads the label and its words say so in red. */
.usage { display: grid; gap: var(--gap-words-words); }
.usage-label { display: inline-flex; align-items: center; gap: var(--gap-words-words); font: var(--type-label); color: var(--ink); }
.usage-label > .ico { width: 16px; height: 16px; color: var(--meter-full-ink); }
.usage-numbers { margin: 0; font: var(--type-facts); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.usage-fact { display: inline-block; max-width: 100%; }
.usage-numbers b { font-weight: 600; color: var(--meter-full-ink); }
.usage-track { display: block; }
.usage-groove .groove-fill { transition: width var(--motion-settle) var(--spring); }
/* Any use at all shows: a sliver long enough to show past a cut corner's line at its start. */
.usage:is(.is-used, .is-near) .usage-groove .groove-fill { min-width: 14px; }
.usage:is(.is-near, .is-full) .usage-groove .groove-fill { filter: drop-shadow(0 0 1.5px var(--meter-near)); }
.usage.is-near .usage-groove .groove-light { background: linear-gradient(180deg, var(--meter-near-hi), var(--meter-near)); }
.usage.is-full .usage-groove .groove-light { background: repeating-linear-gradient(-45deg, var(--meter-near) 0 6px, var(--meter-full) 6px 12px); }
/* With parts, the light is what used it, side by side in each part's color, a hairline of the groove between them; past 80% the colors
   stay and the numbers say so, and all used, red stripes run across them. The key names each part with its share: over the track on a
   meter of its own, so the track stays its foot, and under it in a list row or another plate, where the row's lines are over it. Each
   swatch hangs before its words, so the words keep the margin. */
.usage .usage-groove.has-parts .groove-light { background: none; }
.usage .usage-groove.has-parts .groove-fill { filter: none; }
.usage-parts { position: absolute; inset: 0; display: flex; gap: var(--gap-control-row); }
.usage-part { display: block; min-width: 3px; background: var(--part-color); }
.usage.is-full .usage-part { background: repeating-linear-gradient(-45deg, var(--part-color) 0 6px, var(--meter-full) 6px 12px); }
.usage [data-part="0"] { --part-color: var(--part-0); }
.usage [data-part="1"] { --part-color: var(--part-1); }
.usage [data-part="2"] { --part-color: var(--part-2); }
.usage [data-part="3"] { --part-color: var(--part-3); }
.usage [data-part="4"] { --part-color: var(--part-4); }
.usage [data-part="5"] { --part-color: var(--part-5); }
.usage-key { display: flex; flex-wrap: wrap; gap: var(--gap-words-words) var(--gap-block-block); list-style: none; margin: 0; }
.usage-key li { position: relative; display: inline-flex; align-items: center; gap: var(--gap-words-words); font: var(--type-facts); color: var(--ink-2); }
.usage-key .usage-swatch { position: absolute; left: calc(-10px - var(--gap-words-words)); top: calc(50% - 5px); }
.usage-key b { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.usage-swatch { width: 10px; height: 10px; background: var(--part-color); }
`,
  render: usageMeter,
  examples: [
    { label: "Under way", markup: meterPane({ label: "Player-hours this month", usedNumber: 412.6, limitNumber: 1000, unit: "hours", resetDate: "2026-11-01" }) },
    { label: "Past 80%", markup: meterPane({ label: "Requests this month", usedNumber: 86200, limitNumber: 100000, unit: "requests", resetDate: "2026-11-01" }) },
    { label: "All used", markup: meterPane({ label: "Stored", usedNumber: 500, limitNumber: 500, unit: "MB" }) },
    { label: "Over the limit", markup: meterPane({ label: "Player-hours this month", usedNumber: 1240, limitNumber: 1000, unit: "hours", resetDate: "2026-11-01" }) },
    { label: "A little used: still a sliver", markup: meterPane({ label: "Requests this month", usedNumber: 140, limitNumber: 100000, unit: "requests", resetDate: "2026-11-01" }) },
    { label: "None used", markup: meterPane({ label: "Database rows", usedNumber: 0, limitNumber: 50000, unit: "rows" }) },
    { label: "In its own words: a share of a free allowance", markup: meterPane({ label: "Starfall", usedNumber: 62, limitNumber: 100, unit: "%", resetDate: "2026-11-01", shownWords: "62% of this month's free hosting" }) },
    { label: "Two allowances on one track: free, then a budget the game lives on (used up is not a warning until the budget is)", markup: meterPane({ label: "Starfall", usedNumber: 100 + 2 * 45, limitNumber: 300, warnFromNumber: 260, isFullFine: true, unit: "", resetDate: "2026-11-01", shownWords: "Free part used. $18 of $40 budget" }) },
    { label: "Split by what used it: a color for each part, with its share in the key", markup: meterPane({ label: "Starfall", usedNumber: 62, limitNumber: 100, unit: "%", resetDate: "2026-11-01", shownWords: "62% of this month's free hosting", parts: [{ label: "Rooms", sharePct: 48, partColorIndex: 0 }, { label: "Game server", sharePct: 27, partColorIndex: 1 }, { label: "Database", sharePct: 15, partColorIndex: 3 }, { label: "Requests", sharePct: 10, partColorIndex: 4 }] }) },
    { label: "Split, past 80%", markup: meterPane({ label: "Kestrel", usedNumber: 86, limitNumber: 100, unit: "%", resetDate: "2026-11-01", shownWords: "86% of this month's free hosting", parts: [{ label: "Relay", sharePct: 75, partColorIndex: 2 }, { label: "Rooms", sharePct: 25, partColorIndex: 0 }] }) },
    { label: "Split, all used", markup: meterPane({ label: "Ashen Crown", usedNumber: 100, limitNumber: 100, unit: "%", resetDate: "2026-11-01", shownWords: "100% of this month's free hosting", parts: [{ label: "Rooms", sharePct: 100, partColorIndex: 0 }] }) },
  ],
});

component({
  name: "Usage track",
  slug: "usage-track",
  group: "data",
  subgroup: "numbers",
  summary: "A usage meter's track and its parts' key alone, for a list row or a plate whose own lines say the numbers: a game's hosting in developer settings and on its dashboard.",
  styles: "",
  render: usageTrack,
  examples: [
    {
      label: "Split by what used it, its key under the track, in a list row whose lines say the numbers",
      markup: glassPane({
        paneWidth: "fit",
        body: listRows({
          whenEmpty: html``,
          rows: [{ title: "Starfall", detail: "62% of this month's free hosting · Resets Nov 1", meter: { label: "Starfall", usedNumber: 62, limitNumber: 100, unit: "%", parts: [{ label: "Rooms", sharePct: 48, partColorIndex: 0 }, { label: "Game server", sharePct: 27, partColorIndex: 1 }, { label: "Database", sharePct: 15, partColorIndex: 3 }, { label: "Requests", sharePct: 10, partColorIndex: 4 }] } }],
        }),
      }),
    },
  ],
});
