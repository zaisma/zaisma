import { accountPicture, html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { cutButton, runButton, textLink } from "./actions.ts";
import type { ControlMarkup } from "./control-markup.ts";
import { CUT_LINE, MINUTE_MS, ago, glassPane, icon, tag, type IconName, type TagTone } from "./foundations.ts";

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
export function pictureFrame(username: string, pictureSize: PictureSize, options: { presence?: "online" | "playing"; isCut?: boolean } = {}): Raw {
  // The initials are sized to the frame (--frame), so the largest frame takes the account's picture at its largest size.
  const picture = accountPicture(username, pictureSize === "lg" ? "md" : pictureSize, { title: "" });
  const presenceMarks = (presence: "online" | "playing") => html`<span class="presence-line" aria-hidden="true"></span>${presence === "playing" ? html`<span class="presence-play" aria-hidden="true">${icon("play")}</span>` : ""}`;
  // Cut: where it stands as a control in a pane's corner (your picture at the header's end), it's cut by the edge rule like one, and its
  // presence marks sit inside it, along its foot, so the cut trims them and nothing hangs outside it.
  if (options.isCut) {
    return html`<span class="frame ${pictureSize} glass is-cut" data-glass data-cut-line="10" data-glass-band="2" aria-hidden="true"><span class="frame-picture">${picture}</span>${options.presence ? presenceMarks(options.presence) : ""}</span>`;
  }
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
}

/** The glance list: one line per fact, each with its own look. People and a clock are line icons; friends are their pictures; an update is a green tag. */
export function glanceFacts(facts: GlanceFacts): Raw {
  const nowMs = Date.now();
  const friends = facts.friends ?? [];
  return html`<ul class="glance">${facts.playerCount !== undefined ? html`<li>${icon("people")}<span><b>${facts.playerCount.toLocaleString("en-US")}</b> playing now</span></li>` : ""}${
    friends.length ? html`<li class="friends">${pictureRow(friends.map((friend) => friend.username), "sm")}<span><b>${nameList(friends.map((friend) => friend.username))}</b> ${friends.length > 1 ? "are" : "is"} playing</span></li>` : ""
  }${facts.playedAtMs !== undefined ? html`<li>${icon("clock")}<span>You played ${keepUnits(ago(nowMs - facts.playedAtMs))}</span></li>` : ""}${
    facts.updatedAtMs !== undefined ? html`<li>${tag("Updated", "new")}<span>${keepUnits(ago(nowMs - facts.updatedAtMs))}${facts.updatesHref ? html`\u00a0· <span class="glance-fact">${textLink("What's new", facts.updatesHref)}</span>` : ""}</span></li>` : ""
  }</ul>`;
}

export const GLANCE_STYLES = `
/* The glance list: one line per fact, each with its own look. People and a clock are line icons; friends are their pictures; an update is a green tag.
   What leads each line sits in a column of its own, so every line's words start at one place, however wide its lead. */
.glance { list-style: none; margin: 0; padding: 0 var(--pad-words); display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--gap-words-words); font: var(--type-words); color: var(--ink-2); }
/* Under something else in its pane (a game's title), a hairline parts them; at the top of its pane it needs none. */
* + .glance { padding-top: var(--gap-words-words); border-top: var(--divider); }
.glance li { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; min-height: 24px; }
.glance li > :first-child { justify-self: start; }
.glance b { font-weight: 600; color: var(--ink); }
.glance .ico { color: var(--muted); stroke-width: 1.5; }
/* A link after the facts goes onto the next line whole, never split. */
.glance-fact { display: inline-block; }
`;

component({
  name: "Picture frame",
  slug: "picture-frame",
  group: "data",
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
.frame .av { position: absolute; inset: 0; width: 100%; height: 100%; display: grid; place-items: center; font: 600 calc(var(--frame) * 0.38) var(--display); color: #fff; letter-spacing: 0.01em;
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
.frame.is-cut > .presence-line { position: absolute; z-index: 5; left: 0; right: 0; bottom: 0; height: 3px; clip-path: none; }
.frame.is-cut > .presence-play { position: absolute; z-index: 6; left: 0; right: auto; bottom: 0; }
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
    { label: "Cut, as the account button: online", markup: pictureFrame("emma_r", "md", { presence: "online", isCut: true }) },
    { label: "Cut, as the account button: playing", markup: pictureFrame("Oliver", "md", { presence: "playing", isCut: true }) },
  ],
});

component({
  name: "Picture row",
  slug: "picture-row",
  group: "data",
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
  summary: "A few words or a number carved into what they label, slanted at both ends: Updated on a game, the count of unread topics on a place, a version's state. On glass, a mark's name on the rail.",
  styles: `
/* A tag: slanted at both ends, in --type-tag, carved into the glass it's on: shaded along its top, lit along its foot. Its tone says what it is:
   new or live (green), a count or plain words (the glass's own carving), a warning (amber), or glass (a sliver of the menus' glass, floating over the page). */
.tag { display: inline-flex; align-items: center; justify-content: center; height: 22px; min-width: 22px; padding: 0 10px 0 9px; flex: none; white-space: nowrap;
  font: var(--type-tag); clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); }
.tag.new, .tag.count, .tag.plain, .tag.warning { box-shadow: var(--tag-carve); }
.tag.new { color: var(--tag-new-ink); background: var(--tag-new); }
.tag.count { padding: 0 8px; color: var(--ink-2); background: var(--tag-plain); font-variant-numeric: tabular-nums; }
.tag.plain { color: var(--ink-2); background: var(--tag-plain); }
.tag.warning { color: var(--tag-warning-ink); background: var(--tag-warning); }
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

export interface CountryOptions {
  /** Its two-letter code (ISO 3166-1), any case: its flag. */
  countryCode: string;
  /** Its name, said beside the flag: Germany. */
  countryName: string;
  /** Only the flag shows (a column of them); the name is said to screen readers and shown where the pointer rests. */
  isNameHidden?: boolean;
}

/**
 * A country: its flag, small, cut with slanted ends like a Tag and carved into the glass, beside its name. Where a room runs. The flags are
 * flag-icons' (MIT), drawn small into brand/flags; the flag says it at a glance, the name says it in words.
 */
export function country(options: CountryOptions): Raw {
  return html`<span class="country"${options.isNameHidden ? html` title="${options.countryName}"` : ""}><span class="country-flag" aria-hidden="true"><img src="/flags/${options.countryCode.toLowerCase()}.png" alt="" width="20" height="15" loading="lazy" decoding="async"></span><span${options.isNameHidden ? raw(' class="sr"') : ""}>${options.countryName}</span></span>`;
}

component({
  name: "Country",
  slug: "country",
  group: "data",
  summary: "Where something is, like the country a room runs in: its flag, small, cut with slanted ends and carved into the glass like a Tag, beside its name.",
  styles: `
/* A country: the flag and its name a word's gap apart. The flag is slanted at both ends like a Tag and carved the same way: its carving lies
   over its edges, shaded along its top and lit along its foot, so it sits in the glass instead of on it. */
.country { display: inline-flex; align-items: center; gap: var(--gap-words-words); min-width: 0; white-space: nowrap; }
.country-flag { position: relative; flex: none; display: block; width: 22px; height: 15px; clip-path: polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%); }
.country-flag img { display: block; width: 100%; height: 100%; object-fit: cover; }
.country-flag::after { content: ""; position: absolute; inset: 0; box-shadow: var(--tag-carve); }
`,
  render: country,
  examples: [
    { label: "Where a room runs", markup: html`${country({ countryCode: "DE", countryName: "Germany" })}` },
    { label: "Only the flag, its name for screen readers", markup: html`${country({ countryCode: "JP", countryName: "Japan", isNameHidden: true })}` },
    { label: "Others", markup: html`${country({ countryCode: "JP", countryName: "Japan" })} ${country({ countryCode: "BR", countryName: "Brazil" })} ${country({ countryCode: "SE", countryName: "Sweden", isNameHidden: true })}` },
  ],
});

interface ListRowParts {
  title: string;
  /**
   * A line under its title, in quiet words. Facts in it are said with " · " between them ("2 days ago · 312 files · 48 MB"): each wraps
   * whole, and a number keeps its unit.
   */
  detail?: string;
  /** Words to read under its title, kept as written, line breaks and all (a game's patch notes). */
  text?: string;
  /** A second line under the first, said the same way: when it was last used, what it's waiting for. */
  secondDetail?: string;
  /** What leads the row, before its title: a Picture frame (a player, a friend) or an icon (a key, a passkey). */
  lead?: Raw;
  /** What sits at its end: a Tag (a version's state is VERSION_STATE_TAGS') or a few words. */
  end?: Raw | string;
  /** The gallery's fixed states. */
  state?: "is-pointed" | "is-pressed" | "is-focused";
}

/** A row that goes somewhere is a link as a whole, so it never holds a button; a row to read may end in one (Remove, Invite). */
export type ListRow = ListRowParts & ({ href: string; action?: never; buttonDataAttributes?: never } | { href?: undefined; action?: ControlMarkup; buttonDataAttributes?: never } | { href?: undefined; action?: never; buttonDataAttributes: Record<string, string> });

/** List rows: a list on glass, one thing a row with hairlines between (versions, keys, topics, players); a row with an address is a link as a whole. */
export function listRows(options: { rows: ListRow[]; id?: string; label?: string }): Raw {
  return html`<ul class="list-rows"${options.id ? html` id="${options.id}"` : ""}${options.label ? html` aria-label="${options.label}"` : ""}>${options.rows.map((row) => {
    const details = [row.detail, row.secondDetail].filter((line): line is string => Boolean(line));
    const inside = html`${row.lead ? html`<span class="list-row-lead">${row.lead}</span>` : ""}<span class="list-row-words"><span class="list-row-title">${row.title}</span>${details.map((line) => html`<span class="list-row-detail">${factLine(line, "list-row-fact")}</span>`)}${row.text ? html`<span class="list-row-text">${row.text}</span>` : ""}</span>${row.end !== undefined ? html`<span class="list-row-end">${row.end}</span>` : ""}`;
    const go = html`<span class="list-row-go" aria-hidden="true">${icon("chevron-right")}</span>`;
    const state = row.state ? ` ${row.state}` : "";
    if (row.buttonDataAttributes) return html`<li><button type="button" class="list-row is-link${state}"${Object.entries(row.buttonDataAttributes).map(([name, attributeValue]) => html` data-${name}="${attributeValue}"`)} data-cut-line="8">${CUT_LINE}${inside}${go}</button></li>`;
    return html`<li>${row.href
      ? html`<a class="list-row is-link${state}" href="${row.href}" data-cut-line="8">${CUT_LINE}${inside}${go}</a>`
      : html`<div class="list-row">${inside}${row.action ? html`<span class="list-row-action">${row.action}</span>` : ""}</div>`}</li>`;
  })}</ul>`;
}

const VERSION_LIST_ROWS: ListRow[] = [
  { title: "Version 15", detail: "An hour ago · 314 files · 49.2 MB", href: "#list-rows", end: VERSION_STATE_TAGS.held },
  { title: "Version 14", detail: "2 days ago · 312 files · 48.1 MB", href: "#list-rows", end: VERSION_STATE_TAGS.live },
  { title: "Version 13", detail: "5 days ago · 309 files · 47.6 MB", href: "#list-rows", end: VERSION_STATE_TAGS.replaced },
];
const listPane = (rows: ListRow[]) => glassPane({ paneWidth: "fit", body: listRows({ rows }) });
const ROW_BUTTON = { type: "button", isSmall: true } as const;

component({
  name: "List rows",
  slug: "list-rows",
  group: "data",
  summary: "A list of things on glass, one a row with hairlines between: versions, keys, topics, players. A row that goes somewhere is a link as a whole, ending in a chevron that steps on as you point; a row to read may end in a button.",
  styles: `
/* List rows: one thing a row, hairlines between. A row that's a link ends in a small chevron; under the pointer the row brightens a little
   (a faint slab, cut by the edge rule), an orange mark rises at its start, and the chevron steps on, the way the guest button's arrow does.
   A row may lead with a picture or an icon, take a second line of details, and, when it isn't a link, end in a button. */
.list-rows { list-style: none; margin: 0; padding: 0; display: grid; }
.list-rows > li + li { border-top: var(--divider); }
.list-row { position: relative; display: flex; align-items: center; gap: var(--gap-words-control); min-height: 60px; padding: 10px var(--pad-inside-words); color: var(--ink); text-decoration: none; }
button.list-row { width: 100%; margin: 0; border: 0; font: inherit; text-align: left; cursor: pointer; }
.list-row.is-link { --face-color: transparent; background: var(--face-color); clip-path: var(--cut-shape); transition: --face-color 0.15s; -webkit-tap-highlight-color: transparent; }
.list-row > :not(.cut-line) { position: relative; z-index: 2; }
.list-row-lead { flex: none; display: inline-flex; color: var(--ink-2); }
.list-row-lead > .ico { width: 20px; height: 20px; }
.list-row-words { display: grid; gap: var(--gap-words-words); min-width: 0; flex: 1; }
/* A long title wraps rather than being cut short. */
.list-row-title { font: var(--type-label); color: var(--ink); overflow-wrap: break-word; }
.list-row-detail { font: var(--type-facts); color: var(--muted); }
.list-row-text { font: var(--type-reading); color: var(--ink-2); white-space: pre-line; overflow-wrap: anywhere; }
.list-row-fact { display: inline-block; max-width: 100%; }
.list-row-end { flex: none; display: inline-flex; align-items: center; gap: var(--gap-words-words); font: var(--type-facts); color: var(--ink-2); }
.list-row-action { flex: none; display: inline-flex; }
.list-row-go { flex: none; display: inline-flex; color: var(--muted); transition: transform 0.45s cubic-bezier(.2,.7,.2,1), color 0.2s; }
.list-row-go > .ico { width: 8px; height: 13px; stroke-width: 2.2; }
/* The mark at its start: a short orange bar, cut at its ends, growing from its middle, halfway between the row's edge and its words. */
.list-row.is-link::before { content: ""; position: absolute; z-index: 2; left: 0; top: 30%; bottom: 30%; width: 3px; background: var(--run); transform: scaleY(0); transition: transform 0.3s cubic-bezier(.2,.8,.2,1); }
.list-row.is-link:hover, .list-row.is-link.is-pointed { --face-color: var(--row-hover); }
.list-row.is-link:hover::before, .list-row.is-link.is-pointed::before, .list-row.is-link.is-pressed::before, .list-row.is-link:focus-visible::before { transform: scaleY(1); }
.list-row.is-link:hover > .list-row-go, .list-row.is-link.is-pointed > .list-row-go { transform: translateX(3px); color: var(--ink); }
.list-row.is-link:active, .list-row.is-link.is-pressed { --face-color: var(--row-press); }
.list-row.is-link:focus-visible { outline: none; }
.list-row.is-link:focus-visible > .cut-line polygon, .list-row.is-link.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
@media (prefers-reduced-motion: reduce) { .list-row.is-link::before, .list-row-go { transition: none; } }
`,
  render: listRows,
  examples: [
    { label: "Rows that go somewhere", isWide: true, markup: listPane(VERSION_LIST_ROWS) },
    { label: "Pointed", markup: listPane([{ title: "Ashen Crown", detail: "Unlisted · 2,318 players this week", href: "#list-rows", state: "is-pointed" }]), isStill: true },
    { label: "Pressed", markup: listPane([{ title: "Ashen Crown", detail: "Unlisted · 2,318 players this week", href: "#list-rows", state: "is-pressed" }]), isStill: true },
    { label: "Keyboard focus", markup: listPane([{ title: "Ashen Crown", detail: "Unlisted · 2,318 players this week", href: "#list-rows", state: "is-focused" }]), isStill: true },
    { label: "A long title wraps", markup: listPane([{ title: "Ashen Crown: Chronicles of the Long Winter, Definitive Edition", detail: "Listed · 18,420 players this week", href: "#list-rows", end: VERSION_STATE_TAGS.live }]) },
    {
      label: "Led by pictures, a button a row",
      isWide: true,
      markup: listPane([
        { lead: pictureFrame("Sofia", "md", { presence: "playing" }), title: "Sofia", detail: "Playing Ashen Crown", action: cutButton("Invite", ROW_BUTTON) },
        { lead: pictureFrame("Liam", "md", { presence: "online" }), title: "Liam", detail: "Online", action: cutButton("Invite", ROW_BUTTON) },
        { lead: pictureFrame("Noah", "md"), title: "Noah", detail: "Played 3 days ago", action: cutButton("Invite", ROW_BUTTON) },
      ]),
    },
    {
      label: "Led by icons, with a second line",
      isWide: true,
      markup: listPane([
        { lead: icon("passkey"), title: "MacBook Pro", detail: "iCloud Keychain · added Oct 2", secondDetail: "Used today", action: cutButton("Remove", ROW_BUTTON) },
        { lead: icon("key"), title: "Claude", detail: "Reads, uploads · made Oct 12", secondDetail: "Used an hour ago", action: cutButton("Remove", ROW_BUTTON) },
      ]),
    },
    { label: "Rows to read, not to open", markup: listPane([{ title: "Claude", detail: "Made Oct 12 · used an hour ago", end: "Reads, uploads" }, { title: "Build server", detail: "Made Sep 30 · used yesterday", end: "Uploads" }]) },
    { label: "Rows that lead on in place, like a report's reasons", markup: glassPane({ paneWidth: "fit", body: listRows({ rows: [{ title: "It's broken", detail: "Won't load, crashes, or isn't really a game", buttonDataAttributes: { reason: "broken" } }, { title: "Something else", buttonDataAttributes: { reason: "other" } }] }) }) },
    {
      label: "Rows with words to read, like a game's updates",
      markup: glassPane({ paneWidth: "fit", body: listRows({ label: "Updates", rows: [
        { title: "Oct 19, 2026", text: "Co-op saves now carry over between hosts.\nThe cave map loads twice as fast on phones." },
        { title: "Oct 11, 2026", text: "Two new caves, and a lantern that lasts the whole night." },
      ] }) }),
    },
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
  html`<div class="state-note${tone}${options.action ? " has-action" : ""}">${mark}<div class="state-words"><p class="state-title">${options.title}</p><p class="state-text">${options.text}</p></div>${options.action ? html`<div class="state-action">${options.action}</div>` : ""}</div>`;

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
.state-words { display: grid; gap: var(--gap-words-words); max-width: 46ch; padding-inline: var(--pad-words); }
.state-title { margin: 0; font: var(--type-name); color: var(--ink); }
.state-text { margin: 0; font: var(--type-words); color: var(--ink-2); }
.state-action { justify-self: stretch; display: grid; margin-top: calc(var(--gap-block-block) - var(--gap-words-control)); }
`;

component({
  name: "Empty state",
  slug: "empty-state",
  group: "data",
  summary: "Where a list has nothing yet: what will be here, how it gets here, and the button that starts it. In the voice, never a picture.",
  styles: STATE_STYLES,
  render: emptyState,
  examples: [
    { label: "With what starts it", markup: glassPane({ paneWidth: "fit", body: emptyState({ title: "No games yet", text: "Make one from your AI, or upload a folder with an index.html from your terminal.", action: runButton("Make a game", { type: "button", isFullWidth: true }) }) }) },
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
  summary: "Where content couldn't come: what went wrong in plain words, and what to do about it, like Try again.",
  styles: "",
  render: problemState,
  examples: [
    { label: "With what to do", markup: glassPane({ paneWidth: "fit", body: problemState({ title: "Couldn't load your versions", text: "Zaisma didn't answer in time. Nothing is lost.", action: cutButton("Try again", { type: "button", isFullWidth: true }) }) }) },
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
  summary: "Where a task just ended, in place of it: what was done and what happens next, like a report sent. A moment that passes is a Notice instead.",
  styles: "",
  render: doneState,
  examples: [
    { label: "With the way on", markup: glassPane({ paneWidth: "fit", body: doneState({ title: "Report sent", text: "Zaisma looks at it within a day and tells you what it did.", action: cutButton("Close", { type: "button", isFullWidth: true }) }) }) },
    { label: "Words alone", markup: glassPane({ paneWidth: "fit", body: doneState({ title: "Version 15 is live", text: "Players get it the next time they open the game." }) }) },
  ],
});

/** A loading state: a hairline with a light running along it, and what's coming, where the content will be. Never a spinner over content. */
export function loadingState(options: { label: string }): Raw {
  return html`<div class="loading-state" role="status"><span class="loading-line" aria-hidden="true"></span><span class="loading-label">${options.label}</span></div>`;
}

component({
  name: "Loading state",
  slug: "loading-state",
  group: "data",
  summary: "Where content is on its way: a hairline with a light running along it, and what's coming. Never a spinner over content; a button that's waiting shows the loader instead.",
  styles: `
/* Loading: a hairline across where the content will be, a light running along it the way it runs along a cover's line, and its words
   under it. Under reduced motion the light rests in the middle. */
.loading-state { display: grid; gap: var(--gap-words-control); justify-items: center; padding: var(--gap-block-block) var(--pad-words); }
.loading-line { position: relative; display: block; width: min(240px, 100%); height: 2px; overflow: hidden; background: var(--line); }
.loading-line::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--ink) 70%, transparent), transparent); animation: loading-run 1.3s cubic-bezier(.45,0,.25,1) infinite; }
@keyframes loading-run { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.loading-label { font: var(--type-facts); color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .loading-line::after { animation: none; transform: translateX(75%); } }
`,
  render: loadingState,
  examples: [{ label: "Loading", markup: glassPane({ paneWidth: "fit", body: loadingState({ label: "Getting your versions" }) }) }],
});

export interface TableColumn {
  label: string;
  /** Its label is said only to screen readers: a column of buttons whose words say it (Join). */
  isLabelHidden?: boolean;
  /** Its width, in a table of even columns (isEven): a column of flags or buttons keeps this; the rest share what's left equally. */
  widthPx?: number;
  /** Its heading sorts the rows by its numbers: most first, then fewest first, then back to the table's own order. */
  isSortable?: boolean;
  /** Its cells are numbers: in figures of one width, so a column's digits line up. Every column, numbers too, starts at its heading's left. */
  isNumeric?: boolean;
}

export interface TableOptions {
  /** What the table is, said to screen readers. The table is only its well and rails: a page that names it on screen puts its own label
   *  or heading above it, like anything else. */
  label: string;
  columns: TableColumn[];
  /** One list of cells a row, in the columns' order. A cell that's a list of controls (a room's Join and Report) sets them side by side. */
  rows: (Raw | string | ControlMarkup[])[][];
  /** The one column that stays put as the table scrolls sideways, in the header row's look; a table has one at most. "first": it names
   *  each row (a version, a player), so it's the row's head. "last": its buttons (a room's Join), kept in reach at the right on a phone. */
  headColumn?: "first" | "last";
  /** A last row that sums the columns up (a Total), in the header's look: it stays under the rows as they scroll, one cell a column. */
  footRow?: (Raw | string)[];
  /** The most rows a page shows. Past it, or past what fits in the table's height (--table-height), the table turns pages instead of
   *  scrolling, with a pager under it; a table with few enough rows never shows one. */
  maximumRowCount?: number;
  /** Said inside the table, under its header, when it has no rows (nothing yet, or filters nothing matches): the table stays. */
  emptyText?: string;
  /** The rows are one slice of a longer list the page loads a slice at a time (a game's rooms): where in it they start, from 1, and how
   *  many there are in all. The pager counts them all, and a step past the slice asks the page for the next one: a table-rows-wanted
   *  event on the table, its detail the row's number (rowNumber). */
  rowSlice?: { firstRowNumber: number; totalRowCount: number };
  /** Closer rows, for long lists (logs, requests). */
  isCompact?: boolean;
  /** About five rows tall, so what's after it on the page stays near (a game's rooms); more scroll inside it under its header. */
  isShort?: boolean;
  /** Even columns: the table fills its box, columns with a widthPx keep it and the rest share the rest equally, so columns stay put as
   *  rows change (a list that refreshes, like a game's rooms). Words too long for a column end in an ellipsis. It scrolls sideways only
   *  below its columns' widths together (112px for one without its own), and a pinned last column fits its buttons. */
  isEven?: boolean;
  /** Unique on the page. Defaults to a slug of its label. */
  id?: string;
}

/**
 * A table in a carved well, like the switch's: a header row over its rows, hairlines between rows, every column starting at its heading's left, numbers in figures of one
 * width, and at most one head column (headColumn) that stays put as it scrolls sideways: the first, naming the rows, or the last, its
 * buttons. On a phone it scrolls sideways inside its well, fading at its edges: a row never folds into a card,
 * since players and developers compare rows. Its well is cut by the edge rule, so its corners follow the pane's where it sits in one.
 *
 * Nothing ever scrolls under anything: the header row, the rows and the head column are parts of their own, each clipped at its own edge.
 * The rows scroll up and down in a box under the header (and the head column with them, beside it); the rest of each row scrolls sideways
 * inside that, and the header's copy of those columns follows it on the browser's own scrolling (TABLE_SCRIPT, with a scroll timeline).
 * The header's parts carry a hidden copy of the rows and the rows' parts a flat copy of the header, so each part's columns are as wide as
 * the other's. Screen readers get one whole table: the rows' part, with its header and the rows' heads (headColumn "first") read out.
 */
/** The least a column without its own width takes in a table of even columns: below the sum of them all, the table scrolls sideways. */
const EVEN_COLUMN_MINIMUM_WIDTH_PX = 112;

export function table(options: TableOptions): Raw {
  const id = options.id ?? `table-${options.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const allIndexes = options.columns.map((_, columnIndex) => columnIndex);
  const headIndex = options.headColumn === "first" ? 0 : options.headColumn === "last" ? options.columns.length - 1 : null;
  // The columns that scroll sideways: all but a last head column; a first one stays in, said only to screen readers, so each row has its head.
  const mainIndexes = allIndexes.filter((columnIndex) => !(options.headColumn === "last" && columnIndex === headIndex));
  const isRowHead = (columnIndex: number) => options.headColumn === "first" && columnIndex === 0;
  const numeric = (columnIndex: number) => (options.columns[columnIndex]?.isNumeric ? raw(' class="num"') : "");
  const compact = options.isCompact ? " compact" : "";
  // A heading as the header shows it (a sort button, or words), and as the rows' part carries it: flat, its words for screen readers.
  const heading = (columnIndex: number, part: "head" | "rows", isSide = false) => {
    const column = options.columns[columnIndex]!;
    const sort = column.isSortable ? raw(' aria-sort="none"') : "";
    // A first head column's heading shows in its own part (side), never in the zero-width column the scrolling columns keep for it.
    const shown = column.isLabelHidden || isRowHead(columnIndex) && !isSide ? "" : column.isSortable ? html`<button type="button" class="table-sort"${part === "rows" ? raw(' tabindex="-1"') : ""}>${column.label}${icon("chevron-down")}</button>` : column.label;
    if (isRowHead(columnIndex) && !isSide) return part === "head" ? raw('<th class="table-row-head"></th>') : html`<th scope="col" class="table-row-head"><span class="sr">${column.label}</span></th>`;
    return part === "head"
      ? html`<th${numeric(columnIndex)}${sort}>${column.isSortable ? shown : html`<span aria-hidden="true">${shown}</span>`}</th>`
      : html`<th scope="col"${numeric(columnIndex)}${sort}><span class="table-label" aria-hidden="true">${shown}</span><span class="sr">${column.label}</span></th>`;
  };
  const shownCell = (value: Raw | string | ControlMarkup[] | undefined) => (Array.isArray(value) ? html`<div class="table-controls">${value}</div>` : (value ?? ""));
  const cell = (row: (Raw | string | ControlMarkup[])[], columnIndex: number, part: "head" | "rows" | "side") =>
    isRowHead(columnIndex) && part !== "side" ? html`<th scope="row" class="table-row-head"><span class="sr">${shownCell(row[columnIndex])}</span></th>` : html`<td${numeric(columnIndex)}>${shownCell(row[columnIndex])}</td>`;
  const body = (indexes: number[], part: "head" | "rows" | "side") =>
    html`<tbody>${options.rows.map((row) => html`<tr>${indexes.map((columnIndex) => cell(row, columnIndex, part))}</tr>`)}</tbody>`;
  // The footer row: shown in its own part, flat in the rows' part (its words for screen readers), hidden in the header's.
  const footCell = (columnIndex: number, part: "head" | "rows" | "foot") => {
    const footValue = options.footRow?.[columnIndex] ?? "";
    if (isRowHead(columnIndex) && part !== "foot") return html`<td class="table-row-head"><span class="sr">${footValue}</span></td>`;
    return part === "rows" ? html`<td${numeric(columnIndex)}><span class="table-label" aria-hidden="true">${footValue}</span><span class="sr">${footValue}</span></td>` : html`<td${numeric(columnIndex)}>${footValue}</td>`;
  };
  const foot = (indexes: number[], part: "head" | "rows" | "foot") => (options.footRow ? html`<tfoot><tr>${indexes.map((columnIndex) => footCell(columnIndex, part))}</tr></tfoot>` : "");
  const minimumWidth = options.isEven ? html` style="--table-min-width:${mainIndexes.reduce((widthPx, columnIndex) => widthPx + (isRowHead(columnIndex) ? 0 : options.columns[columnIndex]!.widthPx ?? EVEN_COLUMN_MINIMUM_WIDTH_PX), 0)}px"` : "";
  const columnWidths = options.isEven
    ? html`<colgroup>${mainIndexes.map((columnIndex) => (isRowHead(columnIndex) ? raw('<col style="width:0">') : options.columns[columnIndex]!.widthPx ? html`<col style="width:${options.columns[columnIndex]!.widthPx}px">` : raw("<col>")))}</colgroup>`
    : "";
  // The columns that scroll: in the header (role presentation, its rows hidden) and in the rows' part, the table screen readers read.
  const main = (part: "head" | "rows" | "foot") =>
    html`<table class="data-table${compact}${options.isEven ? " even" : ""}"${part === "rows" ? html` id="${id}" aria-label="${options.label}"` : raw(' role="presentation"')}${minimumWidth}>${columnWidths}<thead><tr>${mainIndexes.map((columnIndex) => heading(columnIndex, part === "head" ? "head" : "rows"))}</tr></thead>${body(mainIndexes, part === "rows" ? "rows" : "head")}${foot(mainIndexes, part)}</table>`;
  // The head column: its heading in the header, its cells beside the rows. A first one's words are read in the rows' part already; a last
  // one's buttons are read here.
  const side = (part: "head" | "rows" | "foot") =>
    headIndex === null
      ? ""
      : html`<table class="data-table table-side ${options.headColumn}${compact}"${part === "rows" && options.headColumn === "first" ? raw(' aria-hidden="true"') : raw(' role="presentation"')}><thead><tr>${heading(headIndex, part === "head" ? "head" : "rows", true)}</tr></thead>${body([headIndex], "side")}${foot([headIndex], part === "rows" ? "head" : "foot")}</table>`;
  const first = (part: "head" | "rows" | "foot") => (options.headColumn === "first" ? side(part) : "");
  const last = (part: "head" | "rows" | "foot") => (options.headColumn === "last" ? side(part) : "");
  const footPart = options.footRow ? html`<div class="table-foot">${first("foot")}<div class="table-foot-main">${main("foot")}</div>${last("foot")}</div>` : "";
  // The pager: hidden until the rows need pages (TABLE_SCRIPT).
  const pager = html`<nav class="table-pages" aria-label="Pages of ${options.label}" hidden><p class="table-page-words" aria-live="polite"></p><div class="table-controls">${cutButton("First page", { type: "button", icon: "arrow-first", isLabelHidden: true, isSmall: true, dataAttributes: { "page-step": "first" } })}${cutButton("Previous page", { type: "button", icon: "arrow-back", isLabelHidden: true, isSmall: true, dataAttributes: { "page-step": "-1" } })}${cutButton("Next page", { type: "button", icon: "arrow-on", isLabelHidden: true, isSmall: true, dataAttributes: { "page-step": "1" } })}${cutButton("Last page", { type: "button", icon: "arrow-last", isLabelHidden: true, isSmall: true, dataAttributes: { "page-step": "last" } })}</div></nav>`;
  return html`<div class="table${options.isShort ? " is-short" : ""}"${options.maximumRowCount ? html` data-maximum-row-count="${options.maximumRowCount}"` : ""}${options.rowSlice ? html` data-first-row-number="${options.rowSlice.firstRowNumber}" data-total-row-count="${options.rowSlice.totalRowCount}"` : ""}><div class="table-well cut-carved" data-cut-line="10">${CUT_LINE}<div class="table-frame" data-cut-line="8"><div class="table-head">${first("head")}<div class="table-head-main">${main("head")}</div>${last("head")}</div><div class="table-scroll" data-scroll-box><div class="table-rows">${first("rows")}<div class="table-x" data-fades-sideways data-side-rail>${main("rows")}</div>${last("rows")}</div>${options.rows.length ? "" : html`<p class="table-empty">${options.emptyText ?? "Nothing here yet."}</p>`}</div>${footPart}</div></div>${pager}</div>`;
}

/**
 * A table's parts kept in step: sorting by a heading sorts every part's rows alike, each row is as tall in every part, the header's
 * columns follow the rows sideways where the browser can't do it by itself, and the row under the mouse lights in every part, found where
 * the pointer is on every move and every scroll, so the light stays under the pointer as rows scroll past it.
 */
export const TABLE_SCRIPT = `/* tables */(function () {
  var lit = null, pointer = null, sorts = new Map(), slice = function (list) { return Array.prototype.slice.call(list); };
  function partsOf(frame) { return slice(frame.querySelectorAll(".table-rows .data-table")); }
  function mainOf(frame) { return frame.querySelector(".table-x .data-table"); }
  // Every row as tall as its tallest part (a Join button beside a row of words).
  function evenRows(frame) {
    var bodies = partsOf(frame).map(function (part) { return part.tBodies[0]; }).filter(Boolean);
    if (bodies.length < 2) return;
    bodies.forEach(function (body) { slice(body.rows).forEach(function (row) { row.style.height = ""; }); });
    // Rows on another page (is-paged-out, collapsed) are left as they are: they have no height to match until they show.
    slice(bodies[0].rows).forEach(function (row, i) {
      if (row.classList.contains("is-paged-out")) return;
      var tallest = 0; bodies.forEach(function (body) { if (body.rows[i]) tallest = Math.max(tallest, body.rows[i].offsetHeight); });
      bodies.forEach(function (body) { if (body.rows[i]) body.rows[i].style.height = tallest + "px"; });
    });
  }
  // Sorting: by a column's first number, most or fewest first, ties and "none" in the table's own order, every part's rows alike. A table
  // that's put in again (a refreshed list) keeps the sort it had, by its id.
  function sortRows(frame, column, order) {
    var main = mainOf(frame), body = main && main.tBodies[0]; if (!body) return;
    var bodies = partsOf(frame).map(function (part) { return part.tBodies[0]; }).filter(Boolean);
    bodies.forEach(function (each) { slice(each.rows).forEach(function (row, i) { if (row.dataset.place === undefined) row.dataset.place = i; }); });
    var rows = slice(body.rows);
    function numberOf(row) { var found = ((row.cells[column] || {}).textContent || "").match(/-?\\d+(\\.\\d+)?/); return found ? parseFloat(found[0]) : -Infinity; }
    rows.sort(function (a, b) { var place = a.dataset.place - b.dataset.place; return order === "none" ? place : (order === "ascending" ? numberOf(a) - numberOf(b) : numberOf(b) - numberOf(a)) || place; });
    var places = rows.map(function (row) { return row.dataset.place; });
    bodies.forEach(function (each) {
      var byPlace = {}; slice(each.rows).forEach(function (row) { byPlace[row.dataset.place] = row; });
      places.forEach(function (place) { if (byPlace[place]) each.appendChild(byPlace[place]); });
    });
    slice(frame.querySelectorAll(".table-head-main th, .table-x thead th")).forEach(function (head) { if (head.hasAttribute("aria-sort")) head.setAttribute("aria-sort", head.cellIndex === column ? order : "none"); });
    paginate(frame);
  }
  // Pages: as many rows as the table's height holds, or its maximum row count if that's fewer; every part shows the same rows, and the
  // rows' box keeps a whole page's height, so the well never changes size from page to page. A table whose rows are a slice of a longer
  // list (data-first-row-number, data-total-row-count) counts the whole list and asks the page for another slice past its own. Where it
  // is (the first row shown, by its number in the whole list) is kept on what holds it (the nearest data-table-holder that stays while
  // the table is put in again, or its parent), so a refreshed list or the next slice lands where it was; a page that changes what it
  // lists clears it (data-table-row on the holder).
  function sizeOf(frame) {
    // A row is as tall as its tallest part (a Join button beside words), whether or not its parts were matched yet.
    var table = frame.closest(".table"), rowPx = 0;
    partsOf(frame).forEach(function (part) { var shown = part.tBodies[0] && slice(part.tBodies[0].rows).filter(function (row) { return !row.classList.contains("is-paged-out"); })[0]; if (shown) rowPx = Math.max(rowPx, shown.offsetHeight); });
    var roomPx = parseFloat(getComputedStyle(frame.querySelector(".table-scroll")).maxHeight);
    var most = parseInt(table.dataset.maximumRowCount, 10) || Infinity, fitting = rowPx && isFinite(roomPx) ? Math.max(1, Math.floor(roomPx / rowPx)) : Infinity;
    // The rows' box holds a page at a fixed height: its whole height when that's what limits a page, else a page of its tallest rows.
    return { size: Math.min(most, fitting), pagePx: fitting <= most ? roomPx : Math.min(most, fitting) * (rowPx + 1) };
  }
  function paginate(frame) {
    var table = frame.closest(".table"), holder = table.closest("[data-table-holder]") || table.parentElement, pager = table.querySelector(":scope > .table-pages"), scroll = frame.querySelector(".table-scroll");
    var bodies = partsOf(frame).map(function (part) { return part.tBodies[0]; }).filter(Boolean);
    if (!pager || !bodies.length) return;
    bodies.forEach(function (body) { slice(body.rows).forEach(function (row) { row.classList.remove("is-paged-out"); }); });
    var rowCount = bodies[0].rows.length, first = (parseInt(table.dataset.firstRowNumber, 10) || 1) - 1, total = parseInt(table.dataset.totalRowCount, 10) || rowCount;
    var measured = sizeOf(frame), size = measured.size;
    if (total <= size) { pager.hidden = true; scroll.style.minHeight = ""; return; }
    var at = Math.max(0, Math.min(total - 1, parseInt(holder.dataset.tableRow, 10) || first)), local = Math.floor(Math.max(0, Math.min(rowCount - 1, at - first)) / size) * size;
    bodies.forEach(function (body) { slice(body.rows).forEach(function (row, i) { row.classList.toggle("is-paged-out", i < local || i >= local + size); }); });
    holder.dataset.tableRow = first + local;
    scroll.style.minHeight = measured.pagePx + "px";
    pager.hidden = false;
    pager.querySelector(".table-page-words").textContent = (first + local + 1) + "–" + Math.min(first + rowCount, first + local + size) + " of " + total;
    pager.querySelector('[data-page-step="first"]').disabled = pager.querySelector('[data-page-step="-1"]').disabled = first + local === 0;
    pager.querySelector('[data-page-step="last"]').disabled = pager.querySelector('[data-page-step="1"]').disabled = first + local + size >= total;
  }
  document.addEventListener("click", function (event) {
    var step = event.target.closest && event.target.closest(".table-pages [data-page-step]"); if (!step) return;
    var table = step.closest(".table"), frame = table.querySelector(".table-frame"), holder = table.closest("[data-table-holder]") || table.parentElement;
    var rowCount = mainOf(frame).tBodies[0].rows.length, first = (parseInt(table.dataset.firstRowNumber, 10) || 1) - 1, size = sizeOf(frame).size;
    // First and last go to the ends of the whole list (the table lands on the page that holds that row); back and on step a page.
    var now = parseInt(holder.dataset.tableRow, 10) || first, way = step.getAttribute("data-page-step"), total = parseInt(table.dataset.totalRowCount, 10) || rowCount;
    var next = way === "first" ? 0 : way === "last" ? total - 1 : way === "1" ? now + size : now - 1 < first ? now - 1 : Math.max(first, now - size);
    if (next < 0) return;
    holder.dataset.tableRow = next;
    // Past this slice: the page loads the one with that row, and the table lands on it.
    if (next < first || next >= first + rowCount) { table.dispatchEvent(new CustomEvent("table-rows-wanted", { bubbles: true, detail: { rowNumber: next + 1 } })); return; }
    paginate(frame);
  });
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest(".table-head .table-sort"); if (!button) return;
    var head = button.closest("th"), frame = button.closest(".table-frame"), now = head.getAttribute("aria-sort");
    var order = now === "descending" ? "ascending" : now === "ascending" ? "none" : "descending";
    sorts.set(mainOf(frame).id, { column: head.cellIndex, order: order });
    sortRows(frame, head.cellIndex, order);
  });
  var follows = window.CSS && CSS.supports("animation-timeline: scroll()");
  window.zaismaWatch.each(".table-frame", function (frame) {
    var main = mainOf(frame), rows = frame.querySelector(".table-x"), table = frame.closest(".table");
    var follow = slice(frame.querySelectorAll(":is(.table-head-main, .table-foot-main) > .data-table"));
    if (!main || !rows) return;
    var sort = sorts.get(main.id); if (sort) sortRows(frame, sort.column, sort.order);
    // How far the rows scroll sideways, so the header's columns follow them all the way (its scroll timeline runs from 0 to this).
    // And how wide the head column's sides are, so the sideways rail spans only the columns that scroll.
    function reach() {
      table.style.setProperty("--table-x-max", Math.max(0, rows.scrollWidth - rows.clientWidth) + "px");
      ["first", "last"].forEach(function (end) { var side = frame.querySelector(".table-rows .table-side." + end); table.style.setProperty("--table-" + end + "-w", (side ? side.offsetWidth : 0) + "px"); });
    }
    function fit() { evenRows(frame); paginate(frame); reach(); }
    fit(); window.zaismaWatch.size(main, fit); window.zaismaWatch.size(rows, reach);
    partsOf(frame).forEach(function (part) { if (part !== main) window.zaismaWatch.size(part, function () { evenRows(frame); }); });
    if (!follows) rows.addEventListener("scroll", function () { follow.forEach(function (part) { part.style.transform = "translateX(" + -rows.scrollLeft + "px)"; }); }, { passive: true });
  });
  function light(row) {
    if (lit === row) return;
    var frame = (lit || row) && (lit || row).closest(".table-frame");
    function each(at, on) {
      var place = at.sectionRowIndex, home = at.closest(".table-frame");
      partsOf(home).forEach(function (part) { var match = part.tBodies[0] && part.tBodies[0].rows[place]; if (match) match.classList.toggle("is-lit", on); });
    }
    if (lit) each(lit, false); lit = row; if (row) each(row, true);
  }
  function rowAt(x, y) { var under = document.elementFromPoint(x, y); return under && under.closest(".table-rows tbody tr"); }
  document.addEventListener("pointermove", function (event) {
    if (event.pointerType !== "mouse") return;
    pointer = [event.clientX, event.clientY];
    var row = event.target.closest && event.target.closest(".table-rows tbody tr");
    if (row) row.closest(".table-frame").classList.add("is-tracked");
    light(row);
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", function () { pointer = null; light(null); });
  document.addEventListener("scroll", function () { if (pointer) light(rowAt(pointer[0], pointer[1])); }, { capture: true, passive: true });
})();
`;

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
const tablePane = (options: TableOptions) => glassPane({ paneWidth: "full", body: table(options) });

component({
  name: "Table",
  slug: "table",
  group: "data",
  summary: "Rows to compare: versions, requests, players, logs. Its header stays as the rows scroll under it, every column lines up under its heading's left edge, and on a phone it scrolls sideways rather than folding rows into cards.",
  styles: `
/* A table: a carved well, like the switch's, and its rails; a label above it is the page's own, not the table's. Nothing in it is glass: its header row and its head
   column sit in the well itself, in the header's quieter words, with a hairline between them and the rows. Each part is clipped at its own
   edge, so nothing scrolls under anything (see table()). */
.table { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; row-gap: var(--gap-words-control); min-width: 0; --table-head-h: 38px; timeline-scope: --table-x; }
.table:has(.data-table.compact) { --table-head-h: 34px; }
.table.is-short { --table-height: 340px; }
.table > .table-well { grid-row: 1; grid-column: 1; }
/* Its rails, outside the well: up and down beside its right edge, from the header's foot down, and sideways under it. */
/* Each spans only what it scrolls: the rows between the header and the footer, and the columns between the head column's sides
   (--table-first-w, --table-last-w, from TABLE_SCRIPT). */
.table:has(.table-foot) { --table-foot-h: var(--table-head-h); }
.table > .rail[data-rail="box"] { position: relative; grid-row: 1; grid-column: 2; top: auto; right: auto; bottom: auto; margin: calc(var(--table-head-h) + 4px) 0 calc(var(--table-foot-h, 0px) + 4px) 4px; }
.table > .table-pages { grid-row: 3; grid-column: 1; }
/* A rail with nothing to scroll keeps its room, out of sight (over the page's own [hidden]), so the well and the pager under it stay put
   whether the rows scroll, up and down or sideways, or not. */
.table > .rail.is-on[hidden] { display: block !important; visibility: hidden; }
.table > .rail.sideways { grid-row: 2; grid-column: 1; margin: 0 calc(var(--table-last-w, 0px) + 4px) 0 calc(var(--table-first-w, 0px) + 4px); }
/* The pager: where the rows are, and a step back and on, shown only while the rows need pages. */
.table-pages { display: flex; align-items: center; justify-content: space-between; gap: var(--gap-words-control); }
.table-pages[hidden] { display: none; }
.table-page-words { margin: 0; font: var(--type-facts); color: var(--muted); font-variant-numeric: tabular-nums; }
.table-well { position: relative; display: flex; min-width: 0; padding: 4px; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
.table-frame { position: relative; display: flex; flex-direction: column; flex: 1; min-width: 0; clip-path: var(--cut-shape); }
/* The header: the head column's heading, and the scrolling columns' headings in a box that clips them, following the rows sideways. Its
   copy of the rows only sizes its columns. */
.table-head { display: flex; flex: none; box-shadow: inset 0 -1px 0 var(--line); }
.table-head-main { flex: 1; min-width: 0; overflow: hidden; }
.table-head .data-table > :is(tbody, tfoot), .table-foot .data-table > :is(thead, tbody), .table-rows .table-side > tfoot { visibility: collapse; }
/* The footer: the same, under the rows, a hairline above it. */
.table-foot { display: flex; flex: none; box-shadow: inset 0 1px 0 var(--line); }
.table-foot-main { flex: 1; min-width: 0; overflow: hidden; }
.table-foot .data-table tfoot td { box-sizing: border-box; height: var(--table-head-h); padding: 10px 16px; border-top: 0; font: var(--type-facts); color: var(--ink-2); }
.table-foot .data-table.compact tfoot td { padding: 8px 12px; }
.table-rows .data-table tfoot td { height: 0; padding-top: 0; padding-bottom: 0; border-top: 0; }
@supports (animation-timeline: scroll()) {
  :is(.table-head-main, .table-foot-main) > .data-table { animation: table-follow linear both; animation-timeline: --table-x; }
}
@keyframes table-follow { from { transform: none; } to { transform: translateX(calc(-1 * var(--table-x-max, 0px))); } }
/* The rows: up and down in a box under the header, at most --table-height tall with the header (a page sets it where the table shares the
   screen, like a game's rooms); the head column beside them, and the rest of each row sideways inside. Their copy of the header is flat. */
.table-scroll { position: relative; overflow-x: hidden; overflow-y: auto; scrollbar-width: none; max-height: calc(var(--table-height, min(640px, 75dvh)) - var(--table-head-h) - var(--table-foot-h, 0px)); }
.table-scroll::-webkit-scrollbar { display: none; }
/* No rows: the header stays, and the rows' room says so, a page's height tall so the well keeps its size. */
.table-empty { display: grid; place-items: center; min-height: calc(var(--table-height, 240px) - var(--table-head-h)); margin: 0; padding: var(--pad-pane); font: var(--type-words); color: var(--muted); text-align: center; }
.table-rows { display: flex; align-items: flex-start; min-width: 0; }
.table-x { flex: 1; min-width: 0; scroll-timeline: --table-x inline; }
.table-rows .data-table thead th { height: 0; padding-top: 0; padding-bottom: 0; }
.table-label { display: block; height: 0; overflow: hidden; }
.data-table { width: 100%; min-width: max-content; border-collapse: separate; border-spacing: 0; font: var(--type-words); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.data-table.table-side { flex: none; width: auto; min-width: 0; }
.data-table th, .data-table td { white-space: nowrap; text-align: left; }
/* A column whose label is said only to screen readers (its buttons say it). */
.data-table th > .sr { position: absolute; }
/* The header row and the head column: one look, the well's own, in the header's quieter words; a hairline marks where they meet the rows
   once the rows scroll sideways. */
.data-table thead th, .table-side.first td { font: var(--type-facts); color: var(--muted); }
.table-head .data-table thead th { box-sizing: border-box; height: var(--table-head-h); padding: 10px 16px; }
.table:has(.table-x.is-scrollable-sideways) .table-side.first { box-shadow: inset -1px 0 0 var(--line); }
.table:has(.table-x.is-scrollable-sideways) .table-side.last { box-shadow: inset 1px 0 0 var(--line); }
.data-table td, .data-table tbody th { padding: 14px 16px; border-top: var(--divider); }
/* Rows on other pages are collapsed, not removed, so they keep sizing their columns: every page, and the header's copy of the rows, has
   the same widths. The first row shown has no line over it, on any page. */
.data-table tbody tr.is-paged-out { visibility: collapse; }
.data-table tbody tr:nth-child(1 of :not(.is-paged-out)) > * { border-top: 0; }
/* The last row shown closes with a line too, where the well has room under it (a short page, a few rows). */
.data-table tbody tr:nth-last-child(1 of :not(.is-paged-out)) > * { border-bottom: var(--divider); }
/* A first head column's words, in the rows' part, are for screen readers: the column takes no room there. */
.data-table .table-row-head, .table-head .data-table thead th.table-row-head { width: 0; padding: 0; }
.table-x .data-table td:first-child, .table-x .data-table .table-row-head + td { color: var(--ink); }
.data-table code { font: var(--type-code); }
.data-table .num { font-variant-numeric: tabular-nums; }
/* A heading that sorts: its words and a small chevron, quiet until it sorts, then in full ink with the chevron pointing the way it runs. */
.table-sort { display: inline-flex; align-items: center; gap: var(--gap-words-words); margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
.table-sort > .ico { width: 10px; height: 7px; stroke-width: 2.4; opacity: 0.35; transition: transform 0.25s, opacity 0.2s; }
.table-sort:hover > .ico { opacity: 0.7; }
.data-table th:is([aria-sort="ascending"], [aria-sort="descending"]) .table-sort { color: var(--ink); }
.data-table th:is([aria-sort="ascending"], [aria-sort="descending"]) .table-sort > .ico { opacity: 1; }
.data-table th[aria-sort="ascending"] .table-sort > .ico { transform: rotate(180deg); }
.table-sort:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
/* Even columns: laid out from the columns alone, never their rows, so a refresh never moves them; long words end in an ellipsis. */
.data-table.even { table-layout: fixed; min-width: var(--table-min-width); }
.data-table.even td { overflow: hidden; text-overflow: ellipsis; }
/* Buttons in a cell keep their own widths, side by side (a room's Join, and its flat Report). */
/* A table's own controls side by side, in a cell (a room's Join and Report) or its pager: each its own width, never wrapping, two controls
   slanting toward each other (the edge rule's neighbor distance), a text button a little further off. */
.table-controls { display: inline-flex; flex-wrap: nowrap; align-items: center; vertical-align: middle; }
.table-controls > :not(:last-child) { margin-inline-end: var(--gap-control-row-boxes); }
.table-controls > .text-btn:not(:first-child) { margin-inline-start: calc(var(--control-slant) + var(--gap-words-control)); }
[data-glass] .table-controls > .shell { flex: none; }
/* The row under the pointer, in every part: TABLE_SCRIPT lights it (is-lit) and finds it again as the rows scroll, since the browser's own
   hover keeps the row it lit until the pointer moves; without the script, the browser's hover does. */
.table-frame:not(.is-tracked) tbody tr:hover > *, .data-table tbody tr.is-lit > * { background-image: linear-gradient(var(--row-hover), var(--row-hover)); }
.data-table.compact td, .data-table.compact tbody th { padding: 8px 12px; }
.table-head .data-table.compact thead th { padding: 8px 12px; }
.data-table.compact td { font: var(--type-facts); }
/* With more above or below, the rows fade at that edge, the head column with them; sideways, the scrolling columns fade at a side with more
   (data-fades-sideways), and the header's copy of them alike. Each fade is all there or not at all, set by whether there's more that way,
   so it sits still while the rows scroll through it. The header, the head column and the well itself never fade. */
@property --table-fade-top { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --table-fade-bottom { syntax: "<length>"; inherits: false; initial-value: 0px; }
.table-scroll.more-up { --table-fade-top: 28px; }
.table-scroll.more-down { --table-fade-bottom: 28px; }
.table-scroll.is-fading { -webkit-mask-image: linear-gradient(to bottom, transparent, #000 var(--table-fade-top), #000 calc(100% - var(--table-fade-bottom)), transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 var(--table-fade-top), #000 calc(100% - var(--table-fade-bottom)), transparent); transition: --table-fade-top 0.35s, --table-fade-bottom 0.35s; }
/* Sideways, the fade stays on while the rows can scroll that way, its depth easing in and out (0 when there's no more), so it eases away
   at an end instead of snapping off. */
.table-x, .table-head-main, .table-foot-main { transition: --fade-left 0.35s, --fade-right 0.35s; }
.table-x.is-scrollable-sideways, .table:has(.table-x.is-scrollable-sideways) :is(.table-head-main, .table-foot-main) {
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-left), #000 calc(100% - var(--fade-right)), transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-left), #000 calc(100% - var(--fade-right)), transparent 100%); }
.table:has(.table-x.more-left) :is(.table-head-main, .table-foot-main) { --fade-left: var(--fade-sideways-px, 28px); }
.table:has(.table-x.more-right) :is(.table-head-main, .table-foot-main) { --fade-right: var(--fade-sideways-px, 28px); }
`,
  render: table,
  examples: [
    {
      label: "Versions: the first column names each row, and stays as the rest scrolls sideways",
      isWide: true,
      markup: glassPane({ paneWidth: "full", body: table({ label: "Versions", headColumn: "first", columns: [{ label: "Version" }, { label: "State" }, { label: "Files", isNumeric: true, isSortable: true }, { label: "Size", isNumeric: true, isSortable: true }, { label: "Made" }], rows: VERSION_ROWS }) }),
    },
    { label: "Compact: many rows scroll under the header", isWide: true, markup: tablePane({ label: "Requests to your game server", isCompact: true, columns: REQUEST_COLUMNS, rows: REQUEST_ROWS }) },
    {
      label: "No rows: the table stays and says so",
      isWide: true,
      markup: html`<div style="--table-height:200px">${glassPane({ paneWidth: "full", body: table({ label: "Open rooms", isCompact: true, emptyText: "No open rooms like that right now. Pick something else, or press Play to start.", columns: [{ label: "Room" }, { label: "Mode" }, { label: "Players", isNumeric: true }], rows: [] }) })}</div>`,
    },
    {
      label: "Many rows, in pages of five: the pager shows only when the rows need it",
      isWide: true,
      markup: glassPane({ paneWidth: "full", body: table({
        label: "Crashes this week",
        isCompact: true,
        maximumRowCount: 5,
        columns: [{ label: "When" }, { label: "Error" }, { label: "Players", isNumeric: true, isSortable: true }],
        rows: ["Mon 09:12", "Mon 14:40", "Tue 08:03", "Tue 19:55", "Wed 11:20", "Wed 22:48", "Thu 07:31", "Thu 16:09", "Fri 12:44", "Fri 21:17", "Sat 10:02", "Sun 18:36"].map((when, rowIndex) => [when, html`<code>${["TypeError: save is null", "RangeError: map too large", "WebGL context lost"][rowIndex % 3]}</code>`, String(3 + ((rowIndex * 7) % 40))]),
      }) }),
    },
    {
      label: "A list to join from, its height set by the page, its Join pinned, with a footer row",
      isWide: true,
      markup: html`<div style="--table-height:240px">${glassPane({ paneWidth: "full", body: table({
        label: "Open rooms",
        isCompact: true,
        headColumn: "last",
        isEven: true,
        footRow: ["5 rooms", "", "", "13 of 44", ""],
        columns: [{ label: "Room", widthPx: 160 }, { label: "Mode" }, { label: "Where", widthPx: 64 }, { label: "Players", isNumeric: true, widthPx: 88, isSortable: true }, { label: "Join", isLabelHidden: true }],
        rows: [["Friday night", "Survival", country({ countryCode: "DE", countryName: "Germany", isNameHidden: true }), "6 of 8", cutButton("Join", { href: "#table", isSmall: true })], ["Speedrun practice", "Race", country({ countryCode: "SE", countryName: "Sweden", isNameHidden: true }), "3 of 4", cutButton("Join", { href: "#table", isSmall: true })], ["Lantern run", "Survival", country({ countryCode: "FR", countryName: "France", isNameHidden: true }), "2 of 8", cutButton("Join", { href: "#table", isSmall: true })], ["Build night", "Creative", country({ countryCode: "PL", countryName: "Poland", isNameHidden: true }), "1 of 16", cutButton("Join", { href: "#table", isSmall: true })], ["Deep caves", "Survival", country({ countryCode: "ES", countryName: "Spain", isNameHidden: true }), "1 of 8", cutButton("Join", { href: "#table", isSmall: true })]],
      }) })}</div>`,
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
  return html`<dl class="numbers">${options.items.map(
    (numberItem) => html`<div class="number"><dt>${numberItem.label}</dt><dd class="number-figure"><span class="number-amount">${numberItem.figure}</span>${numberItem.unit ? html`<span class="number-unit">${numberItem.unit}</span>` : ""}</dd>${numberItem.change ? html`<dd class="number-change${numberItem.isChangeGood ? " good" : ""}">${numberItem.change}</dd>` : ""}</div>`,
  )}</dl>`;
}

component({
  name: "Numbers",
  slug: "numbers",
  group: "data",
  summary: "A row of figures to take in at a glance: players, hours, plays. Each figure is big, its label sits under it, and how it moved is green when it's good news.",
  styles: `
/* Numbers: big figures in Jost with figures of one width, their unit smaller beside them (under them when there's no room), the label under
   each in facts. They share the row, each at least --size-number wide, two to a line on a phone. A figure never breaks: a long one (the
   millions) takes a wider place, and the others go on to the next line. */
.numbers { display: flex; flex-wrap: wrap; gap: var(--gap-block-block); margin: 0; padding-inline: var(--pad-words); }
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
  if (options.points.length === 0) return html`<figure class="chart"><figcaption class="chart-label">${options.label}</figcaption><p class="chart-empty">No ${options.unit} yet.</p></figure>`;
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
  return html`<figure class="chart" tabindex="0" data-chart-points><figcaption class="chart-label">${options.label}</figcaption><div class="chart-body" aria-hidden="true"><div class="chart-scale">${grid.map(
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
  return html`<figure class="chart ring"><figcaption class="chart-label">${options.label}</figcaption><div class="ring-body"><div class="ring-picture"><svg class="ring-drawing" viewBox="0 0 120 120" aria-hidden="true">${parts}</svg><span class="ring-total"><b>${chartWords(totalNumber)}</b>${options.unit}</span></div><ul class="ring-key">${shares.map(
    (point, shareIndex) => html`<li data-share="${shareIndex}"><span class="ring-swatch" aria-hidden="true"></span><span class="ring-name">${point.label}</span><span class="ring-share">${sharePct(point)}%</span><span class="ring-amount">${chartWords(point.amountNumber)} ${options.unit}</span></li>`,
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
.ring:has(.ring-part[data-share="${shareIndex}"]:hover) .ring-key [data-share="${shareIndex}"] { background: var(--row-hover); }`)
  .join("\n");
const chartPane = (options: ChartOptions) => glassPane({ paneWidth: "full", body: chart(options) });

component({
  name: "Chart",
  slug: "chart",
  group: "data",
  summary: "How something moved over time, drawn on the page with nothing to wait for: a line or bars on a hairline grid, the last point marked with its number, and any point's number where you point or step with the arrow keys. Or how a whole splits, as a ring with its key. Screen readers get the same numbers.",
  styles: `
/* A chart over time: its label, then its scale's numbers in a column of their own and the plot beside it, the first and last points' labels
   under the plot. The drawing stretches to the plot while its line keeps its 2px. On a narrow screen each point keeps at least its room
   (--point-room) and the plot scrolls sideways under a scale that stays. The last point is an ink dot with its number over it; pointing at
   any point, or focusing it, shows its dot and its number (a bar's column brightens), its words kept inside the plot at the ends. */
.chart { display: grid; gap: var(--gap-words-control); margin: 0; min-width: 0; padding-inline: var(--pad-words); }
.chart-label { font: var(--type-label); color: var(--ink); }
.chart-body { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--gap-words-control); margin-top: var(--gap-block-block); }
.chart-scale { position: relative; height: 180px; min-width: 32px; font: var(--type-facts); color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
.chart-scale > span { position: absolute; right: 0; transform: translateY(-50%); white-space: nowrap; }
.chart-scroll { min-width: 0; padding-top: var(--gap-block-block); margin-top: calc(-1 * var(--gap-block-block)); }
/* Its dots at the ends keep their whole round inside its padding; anything else past its sides is clipped, never making it scroll. */
.chart-inner { --point-room: 12px; min-width: calc(var(--point-count) * var(--point-room)); padding: 0 6px; overflow-x: clip; }
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
.chart-last-words { position: absolute; right: 0; bottom: 14px; font: var(--type-label); color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; transition: opacity 0.15s; }
.chart-last.is-alone .chart-last-words { right: auto; left: 50%; transform: translateX(-50%); }
/* Over the last bar it spans the bar: its number centered on it, or ending at its right edge when wider. */
.chart-last.is-bar { height: 0; margin: 0; background: none; border-radius: 0; box-shadow: none; }
.chart-last.is-bar .chart-last-words { bottom: 6px; min-width: 100%; text-align: center; }
.chart-body > .rail { grid-column: 2; }
.chart-axis { display: grid; padding-top: var(--gap-words-control); font: var(--type-facts); color: var(--muted); }
.chart-axis > span { grid-area: 1 / 1; justify-self: start; position: relative; white-space: nowrap; }
.chart-axis > .is-end { justify-self: end; }
.chart-axis > .is-middle { transform: translateX(-50%); }
.chart-hit { position: absolute; top: 0; bottom: 0; z-index: 2; }
/* Focused from the keyboard, the chart shows its focused point as pointed at, ringed in the focus color. */
.chart:focus-visible { outline: none; }
.chart-inner.is-bars .chart-hit:is(:hover, .is-pointed), .chart:focus-visible .chart-inner.is-bars .chart-hit.is-focused { background: var(--row-hover); }
.chart:focus-visible .chart-inner.is-bars .chart-hit.is-focused { outline: 2px solid var(--focus); outline-offset: -2px; }
.chart-dot { position: absolute; left: var(--point-left); top: var(--point-top); width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--ink); box-shadow: 0 0 0 3px var(--chart-ring); opacity: 0; transition: opacity 0.15s; }
.chart:focus-visible .chart-hit.is-focused .chart-dot { outline: 2px solid var(--focus); outline-offset: 3px; }
.chart-inner.is-bars .chart-dot { display: none; }
.chart-tip { position: absolute; left: var(--point-left); bottom: calc(100% - var(--point-top) + 12px); transform: translateX(-12px); display: grid; padding: 4px 8px; white-space: nowrap;
  font: var(--type-facts); color: var(--ink-2); background: var(--chart-tip); box-shadow: var(--slab-shade); opacity: 0; transition: opacity 0.15s; pointer-events: none; }
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
.chart-empty { display: grid; place-items: center; height: 180px; margin: var(--gap-block-block) 0 0; border-bottom: var(--divider); font: var(--type-words); color: var(--muted); }
/* A ring: the shares round a ring, biggest first and darkest, each lighter after; the whole in its middle. Its key beside it (under it on a
   phone), no wider than a card so each name reads with its share, names each with its share and number. Pointing at a part or its line in
   the key draws that part in ink and brightens its line. */
.ring-body { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--gap-block-block); }
.ring-picture { position: relative; flex: none; width: 168px; height: 168px; }
.ring-drawing { width: 100%; height: 100%; }
.ring-part { fill: none; stroke-width: 16; stroke: var(--share-color); transition: stroke 0.15s; cursor: default; }
.ring-total { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; font: var(--type-facts); color: var(--muted); }
.ring-total b { font: var(--type-section); color: var(--ink); font-variant-numeric: tabular-nums; }
.ring-key { flex: 0 1 var(--size-card); list-style: none; margin: 0; padding: 0; display: grid; }
.ring-key li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: var(--gap-words-control); padding: var(--gap-words-words) var(--gap-words-words); font: var(--type-words); color: var(--ink); }
.ring-key li:hover { background: var(--row-hover); }
.ring-key li + li { border-top: var(--divider); }
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
}

/**
 * A usage meter: its label, its numbers under it, then a carved track filling in quiet ink, amber from 80%. Any use at all shows as a
 * sliver, never as an empty track. All used, it's unmistakable: the fill is striped amber across the whole track, a warning mark leads its
 * label, and its numbers end in "all used", or in how far over it is.
 */
export function usageMeter(options: UsageMeterOptions): Raw {
  const sharePct = Math.min(100, (options.usedNumber / Math.max(options.limitNumber, 1)) * 100);
  const isAllUsed = options.usedNumber >= options.limitNumber;
  const tone = isAllUsed ? " is-full" : sharePct >= 80 ? " is-near" : options.usedNumber > 0 ? " is-used" : "";
  const overNumber = options.usedNumber - options.limitNumber;
  const allUsedWords = overNumber > 0 ? `, ${chartWords(overNumber)} ${options.unit} over` : ", all used";
  const resetWords = options.resetDate ? `Resets ${new Date(`${options.resetDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.` : "";
  return html`<div class="usage${tone}"><span class="usage-label">${isAllUsed ? icon("warning") : ""}${options.label}</span><p class="usage-numbers"><span class="usage-fact">${chartWords(options.usedNumber)} of ${chartWords(options.limitNumber)}\u00a0${options.unit}${isAllUsed ? html`<b>${allUsedWords}</b>` : ""}${resetWords ? "\u00a0·" : ""}</span>${resetWords ? html` <span class="usage-fact">${resetWords}</span>` : ""}</p><div class="usage-track cut-carved" data-cut-line="6" role="meter" aria-label="${options.label}" aria-valuemin="0" aria-valuemax="${options.limitNumber}" aria-valuenow="${Math.min(options.usedNumber, options.limitNumber)}">${CUT_LINE}<span class="usage-fill" data-cut-line="4" style="width:${sharePct.toFixed(2)}%"></span></div></div>`;
}

const meterPane = (options: UsageMeterOptions) => glassPane({ paneWidth: "fit", body: usageMeter(options) });

component({
  name: "Usage meter",
  slug: "usage-meter",
  group: "data",
  summary: "How much of an allowance is used: player-hours, requests, storage. A carved track fills in ink, turns amber from 80%, and says so when it's all used, or over.",
  styles: `
/* A usage meter: its label on a line of its own, its numbers (and when it resets) under it, the track under them: a carved strip the fill
   grows along, tall enough that at a pane's foot it takes a bevel of 4px (a quarter of its height). The fill is a quiet ink, amber from 80%;
   any use at all shows at least a sliver. All used, it's amber striped with a deeper amber, like tape across a door, and a warning mark
   leads the label. */
.usage { display: grid; gap: var(--gap-words-words); }
.usage-label { display: inline-flex; align-items: center; gap: var(--gap-words-words); padding-inline: var(--pad-words); font: var(--type-label); color: var(--ink); }
.usage-label > .ico { width: 16px; height: 16px; color: var(--meter-full-ink); }
.usage-numbers { margin: 0; padding-inline: var(--pad-words); font: var(--type-facts); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.usage-fact { display: inline-block; max-width: 100%; }
.usage-numbers b { font-weight: 600; color: var(--meter-full-ink); }
.usage-track { position: relative; height: 16px; padding: 3px; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
.usage-fill { display: block; height: 100%; background: var(--meter-fill); clip-path: var(--cut-shape); transition: width 0.6s var(--spring); }
.usage:is(.is-used, .is-near) .usage-fill { min-width: 6px; }
.usage.is-near .usage-fill { background: var(--meter-near); }
.usage.is-full .usage-fill { background: repeating-linear-gradient(-45deg, var(--meter-near) 0 6px, var(--meter-full) 6px 12px); }
`,
  render: usageMeter,
  examples: [
    { label: "Under way", markup: meterPane({ label: "Player-hours this month", usedNumber: 412.6, limitNumber: 1000, unit: "hours", resetDate: "2026-11-01" }) },
    { label: "Past 80%", markup: meterPane({ label: "Requests this month", usedNumber: 86200, limitNumber: 100000, unit: "requests", resetDate: "2026-11-01" }) },
    { label: "All used", markup: meterPane({ label: "Stored", usedNumber: 500, limitNumber: 500, unit: "MB" }) },
    { label: "Over the limit", markup: meterPane({ label: "Player-hours this month", usedNumber: 1240, limitNumber: 1000, unit: "hours", resetDate: "2026-11-01" }) },
    { label: "A little used: still a sliver", markup: meterPane({ label: "Requests this month", usedNumber: 140, limitNumber: 100000, unit: "requests", resetDate: "2026-11-01" }) },
    { label: "None used", markup: meterPane({ label: "Database rows", usedNumber: 0, limitNumber: 50000, unit: "rows" }) },
  ],
});
