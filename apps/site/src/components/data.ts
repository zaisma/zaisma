import { accountPicture, html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { cutButton, runButton, textLink } from "./actions.ts";
import { CUT_LINE, MINUTE_MS, ago, glassPane, icon, tag, type IconName, type TagTone } from "./foundations.ts";

/*
 * Data: an account's picture in its cut frame, and the glance list, one line per fact, each in its own look.
 * From the header draft (the face in the account button) and the home draft (the pane's glance list).
 */

export type PictureSize = "xs" | "sm" | "md";

/**
 * An account's picture (accountPicture, its initials for now) in a small frame of the panes' glass, with its drawn rim. Pictures are the
 * one thing never cut or slanted: always square, alone or in a row, wherever they sit.
 */
export function pictureFrame(username: string, pictureSize: PictureSize, options: { presence?: "online" | "playing"; isCut?: boolean } = {}): Raw {
  const presenceMarks = (presence: "online" | "playing") => html`<span class="presence-line" aria-hidden="true"></span>${presence === "playing" ? html`<span class="presence-play" aria-hidden="true">${icon("play")}</span>` : ""}`;
  // Cut: where it stands as a control in a pane's corner (your picture at the header's end), it's cut by the edge rule like one, and its
  // presence marks sit inside it, along its foot, so the cut trims them and nothing hangs outside it.
  if (options.isCut) {
    return html`<span class="frame ${pictureSize} glass is-cut" data-glass data-cut-line="10" data-glass-band="2" aria-hidden="true"><span class="frame-picture">${accountPicture(username, pictureSize, { title: "" })}</span>${options.presence ? presenceMarks(options.presence) : ""}</span>`;
  }
  const frame = html`<span class="frame ${pictureSize} glass" data-glass data-glass-corners="0 0 0 0" data-glass-band="2" aria-hidden="true"><span class="frame-picture">${accountPicture(username, pictureSize, { title: "" })}</span></span>`;
  // The glass is clipped to its edge, so the presence marks sit outside it: a green line along its foot, and for playing a green tab with a play mark at the line's end.
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
  }${facts.playedAtMs !== undefined ? html`<li>${icon("clock")}<span>You played ${ago(nowMs - facts.playedAtMs)}</span></li>` : ""}${
    facts.updatedAtMs !== undefined ? html`<li>${tag("Updated", "new")}<span>${ago(nowMs - facts.updatedAtMs)}${facts.updatesHref ? html` · ${textLink("What's new", facts.updatesHref)}` : ""}</span></li>` : ""
  }</ul>`;
}

export const GLANCE_STYLES = `
/* The glance list: one line per fact, each with its own look. People and a clock are line icons; friends are their pictures; an update is a green tag. */
.glance { list-style: none; margin: 0; padding: var(--gap-words-words) 0 0; border-top: var(--divider); display: grid; gap: var(--gap-words-words); font: var(--type-words); color: var(--ink-2); }
.glance li { display: flex; align-items: center; gap: var(--gap-words-words); min-height: 24px; }
.glance b { font-weight: 600; color: var(--ink); }
.glance .ico { color: var(--muted); stroke-width: 1.5; }
`;

component({
  name: "Picture frame",
  slug: "picture-frame",
  group: "data",
  summary: "An account's picture, always in its frame of glass: in the account button, beside a friend's name, on a profile. ",
  styles: `
/* An account's picture under a small frame of the panes' glass. Always square: never cut or slanted, alone or in a row. The glass itself
   is clear (no tint of its own), so the picture runs right to its edges and the drawn rim lies over the picture's own colors, the way a
   pane's edge takes the color of what's under it. */
.frame { --frame: 44px; position: relative; display: inline-grid; place-items: center; width: var(--frame); height: var(--frame); flex: none;
  font: var(--type-tag); color: var(--ink); }
.frame.sm { --frame: 32px; }
.frame.xs { --frame: 24px; }
.frame:not(.more) { --glass-tint: transparent; }
.frame.glass > .frame-picture { position: absolute; z-index: 2; inset: 0; }
/* A quiet rim: half the panes' strength, so it reads as glass without framing the face. */
.frame.glass > .edge { z-index: 4; opacity: 0.5; }
.frame .av { position: absolute; inset: 0; display: grid; place-items: center; font: 600 calc(var(--frame) * 0.38) var(--display); color: #fff; letter-spacing: 0.01em;
  background: linear-gradient(140deg, hsl(var(--h) 58% 58%), hsl(calc(var(--h) + 45) 48% 52%) 55%, hsl(calc(var(--h) + 90) 48% 55%)); }
/* Presence, under the picture: online is a green line along its foot, like the orange line under what you're on; playing adds a green tab at the
   line's right end holding a white play mark. Both sit just outside the glass, which is clipped to its edge. */
.frame-presence { position: relative; display: inline-flex; flex: none; --presence-gap: 3px; --presence-line: 3px; }
.frame-presence.xs { --presence-gap: 2px; --presence-line: 2px; }
.presence-line { position: absolute; z-index: 4; left: 0; right: 0; bottom: calc(-1 * (var(--presence-gap) + var(--presence-line))); height: var(--presence-line); background: var(--online);
  clip-path: polygon(2px 0, 100% 0, calc(100% - 2px) 100%, 0 100%); }
.presence-play { position: absolute; z-index: 5; right: -6px; bottom: calc(-1 * (var(--presence-gap) + 8px)); display: grid; place-items: center; width: 20px; height: 13px; color: #fff; background: var(--online);
  box-shadow: 0 1px 3px var(--picture-shadow); clip-path: polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%); }
.presence-play > .play { width: 6px; height: 7px; transform: translateX(0.5px); }
.frame-presence.xs > .presence-play { right: -4px; width: 14px; height: 10px; bottom: calc(-1 * (var(--presence-gap) + 6px)); }
.frame-presence.xs > .presence-play > .play { width: 5px; height: 6px; }
/* A cut frame (your picture at the header's end) holds its presence inside, along its foot, under its rim. */
.frame.is-cut > .presence-line { position: absolute; z-index: 5; left: 0; right: 0; bottom: 0; height: 3px; clip-path: none; }
.frame.is-cut > .presence-play { position: absolute; z-index: 6; left: 50%; right: auto; bottom: 0; transform: translateX(-50%); }
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

component({
  name: "Tag",
  slug: "tag",
  group: "data",
  summary: "A few words or a number carved into what they label, slanted at both ends: Updated on a game, the count of unread topics on a place, Held on a version. On glass, a mark's name on the rail.",
  styles: `
/* A tag: slanted at both ends, in --type-tag, carved into the glass it's on: shaded along its top, lit along its foot. Its tone says what it is:
   new (green), a count or plain words (the glass's own carving), a warning (amber), or glass (a sliver of the menus' glass, floating over the page). */
.tag { display: inline-flex; align-items: center; justify-content: center; height: 22px; min-width: 22px; padding: 0 10px 0 9px; flex: none; white-space: nowrap;
  font: var(--type-tag); clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); }
.tag.new, .tag.count, .tag.warning { box-shadow: var(--tag-carve); }
.tag.new { color: var(--tag-new-ink); background: var(--tag-new); }
.tag.count { padding: 0 8px; color: var(--ink-2); background: var(--tag-plain); font-variant-numeric: tabular-nums; }
.tag.warning { color: var(--tag-warning-ink); background: var(--tag-warning); }
.tag.glass { color: var(--ink); --glass-tint: var(--glass-dropdown); }
`,
  render: (words: string | number, tone: TagTone) => tag(words, tone),
  examples: [
    { label: "New", markup: tag("Updated", "new") },
    { label: "A count", markup: tag(3, "count") },
    { label: "Plain words", markup: tag("Live", "count") },
    { label: "A warning", markup: tag("Held", "warning") },
    { label: "On glass", markup: tag("Continue playing", "glass") },
  ],
});

const HOUR_MS = 60 * MINUTE_MS;
const glancePane = (body: Raw) => glassPane({ paneSize: "small", body });

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

export interface Fact {
  /** What the fact is about, in a few words: Players, Works on. */
  label: string;
  /** The fact itself, in words: Linux. Or its entries, each with the icon that says it at a glance (Single-player, Online co-op). */
  text?: string;
  items?: { text: string; icon: IconName }[];
}

/** Facts: what something is, a few short facts side by side, each a quiet label over its words (a game's players and devices). */
export function facts(options: { facts: Fact[]; label?: string }): Raw {
  return html`<dl class="facts"${options.label ? html` aria-label="${options.label}"` : ""}>${options.facts.map((fact) => html`<div class="fact"><dt>${fact.label}</dt><dd>${fact.items ? fact.items.map((item) => html`<span class="fact-item">${icon(item.icon)}<span>${item.text}</span></span>`) : fact.text ?? ""}</dd></div>`)}</dl>`;
}

component({
  name: "Facts",
  slug: "facts",
  group: "data",
  summary: "What something is, in a few short facts: who a game is for, what it runs on. Each a quiet label over its words, side by side while they fit.",
  styles: `
/* Facts: each a label in a caption's words over the fact in a line's, side by side across the pane while they fit, then wrapping. */
.facts { display: flex; flex-wrap: wrap; gap: var(--gap-words-control) var(--gap-block-block); margin: 0; }
.fact { display: grid; gap: var(--gap-words-words); min-width: 0; }
.fact dt { font: var(--type-facts); color: var(--muted); }
.fact dd { margin: 0; display: flex; flex-wrap: wrap; gap: var(--gap-words-words) var(--gap-words-control); font: var(--type-words); color: var(--ink); }
/* An entry: its line icon, quiet, then its words. */
.fact-item { display: inline-flex; align-items: center; gap: var(--gap-words-words); white-space: nowrap; }
.fact-item > .ico { color: var(--muted); }
`,
  render: facts,
  examples: [
    { label: "A game's players and devices", markup: glassPane({ paneSize: "small", body: facts({ label: "About this game", facts: [{ label: "Players", items: [{ text: "Single-player", icon: "person" }, { text: "Online co-op", icon: "globe" }] }, { label: "Works on", items: [{ text: "Computer", icon: "computer" }, { text: "Tablet", icon: "tablet" }] }] }) }) },
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

export interface PersonOptions {
  username: string;
  /** Their profile. */
  href: string;
  /** A line about them: "12 games on Zaisma". */
  note?: string;
  /** Their profile opens in a new tab, so the page they're named on stays where it was (a game's page). */
  isNewTab?: boolean;
}

/** A person: someone on Zaisma named in a pane (a game's developer), their picture in its frame beside their name, a Link to their profile, and a line about them. */
export function person(options: PersonOptions): Raw {
  return html`<div class="person">${pictureFrame(options.username, "md")}<span class="person-words">${textLink(options.username, options.href, { isNewTab: options.isNewTab })}${options.note ? html`<span class="person-note">${options.note}</span>` : ""}</span></div>`;
}

component({
  name: "Person",
  slug: "person",
  group: "data",
  summary: "Someone on Zaisma named in a pane, like a game's developer: their picture in its frame, their name a Link to their profile, and a line about them.",
  styles: `
/* A person: the picture, then the name over a quiet line, a word's gap from it. */
.person { display: flex; align-items: center; gap: var(--gap-words-control); min-width: 0; }
.person-words { display: grid; gap: var(--gap-words-words); min-width: 0; font: var(--type-name); }
.person-words > .link { justify-self: start; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.person-note { font: var(--type-facts); color: var(--muted); }
`,
  render: person,
  examples: [
    { label: "A game's developer", markup: glassPane({ paneSize: "small", body: person({ username: "lumen_works", href: "#person", note: "12 games on Zaisma" }) }) },
    { label: "Alone", markup: glassPane({ paneSize: "small", body: person({ username: "emma_r", href: "#person" }) }) },
  ],
});


export interface ListRow {
  title: string;
  /** A line under its title, in quiet words. */
  detail?: string;
  /** Words to read under its title, kept as written, line breaks and all (a game's patch notes). */
  text?: string;
  /** Where the row goes: the whole row is the link. */
  href?: string;
  /** Instead of a link, a button that leads on in place (a sheet's next step), with these attributes for the page's script, by name without data-. */
  buttonDataAttributes?: Record<string, string>;
  /** What sits at its end: a Tag or a few words. Never a button in a row that's a link. */
  end?: Raw | string;
  /** The gallery's fixed states. */
  state?: "is-pointed" | "is-focused";
}

/** List rows: a list on glass, one thing a row with hairlines between (versions, keys, topics, players); a row with an address is a link as a whole. */
export function listRows(options: { rows: ListRow[]; id?: string; label?: string }): Raw {
  return html`<ul class="list-rows"${options.id ? html` id="${options.id}"` : ""}${options.label ? html` aria-label="${options.label}"` : ""}>${options.rows.map((row) => {
    const inside = html`<span class="list-row-words"><span class="list-row-title">${row.title}</span>${row.detail ? html`<span class="list-row-detail">${row.detail}</span>` : ""}${row.text ? html`<span class="list-row-text">${row.text}</span>` : ""}</span>${row.end !== undefined ? html`<span class="list-row-end">${row.end}</span>` : ""}`;
    const go = html`<span class="list-row-go" aria-hidden="true">${icon("chevron-right")}</span>`;
    const state = row.state ? ` ${row.state}` : "";
    if (row.buttonDataAttributes) return html`<li><button type="button" class="list-row is-link${state}"${Object.entries(row.buttonDataAttributes).map(([name, attributeValue]) => html` data-${name}="${attributeValue}"`)} data-cut-line="8">${CUT_LINE}${inside}${go}</button></li>`;
    return html`<li>${row.href ? html`<a class="list-row is-link${state}" href="${row.href}" data-cut-line="8">${CUT_LINE}${inside}${go}</a>` : html`<div class="list-row">${inside}</div>`}</li>`;
  })}</ul>`;
}

component({
  name: "List rows",
  slug: "list-rows",
  group: "data",
  summary: "A list of things on glass, one a row with hairlines between: versions, keys, topics, players. A row that goes somewhere is a link as a whole, ending in a chevron that steps on as you point.",
  styles: `
/* List rows: one thing a row, hairlines between. A row that's a link ends in a small chevron; under the pointer the row brightens a little
   (a faint slab, cut by the edge rule), an orange mark rises at its start, and the chevron steps on, the way the guest button's arrow does. */
.list-rows { list-style: none; margin: 0; padding: 0; display: grid; }
.list-rows > li + li { border-top: var(--divider); }
.list-row { position: relative; display: flex; align-items: center; gap: var(--gap-words-control); min-height: 60px; padding: 10px 12px 10px 16px; color: var(--ink); text-decoration: none; }
button.list-row { width: 100%; margin: 0; border: 0; font: inherit; text-align: left; cursor: pointer; }
.list-row.is-link { --face-color: transparent; background: var(--face-color); clip-path: var(--cut-shape); transition: --face-color 0.15s; -webkit-tap-highlight-color: transparent; }
.list-row > :not(.cut-line) { position: relative; z-index: 2; }
.list-row-words { display: grid; gap: var(--gap-words-words); min-width: 0; flex: 1; }
.list-row-title { font: var(--type-label); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-row-detail { font: var(--type-facts); color: var(--muted); }
.list-row-text { font: var(--type-reading); color: var(--ink-2); white-space: pre-line; overflow-wrap: anywhere; }
.list-row-end { flex: none; display: inline-flex; align-items: center; gap: var(--gap-words-words); font: var(--type-facts); color: var(--ink-2); }
.list-row-go { flex: none; display: inline-flex; color: var(--muted); transition: transform 0.45s cubic-bezier(.2,.7,.2,1), color 0.2s; }
.list-row-go > .ico { width: 8px; height: 13px; stroke-width: 2.2; }
/* The mark at its start: a short orange bar, cut at its ends, growing from its middle. */
.list-row.is-link::before { content: ""; position: absolute; z-index: 2; left: 4px; top: 30%; bottom: 30%; width: 3px; background: var(--run); transform: scaleY(0); transition: transform 0.3s cubic-bezier(.2,.8,.2,1); }
.list-row.is-link:hover, .list-row.is-link.is-pointed { --face-color: var(--row-hover); }
.list-row.is-link:hover::before, .list-row.is-link.is-pointed::before, .list-row.is-link:focus-visible::before { transform: scaleY(1); }
.list-row.is-link:hover > .list-row-go, .list-row.is-link.is-pointed > .list-row-go { transform: translateX(3px); color: var(--ink); }
.list-row.is-link:active { --face-color: var(--row-press); }
.list-row.is-link:focus-visible { outline: none; }
.list-row.is-link:focus-visible > .cut-line polygon, .list-row.is-link.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
@media (prefers-reduced-motion: reduce) { .list-row.is-link::before, .list-row-go { transition: none; } }
`,
  render: listRows,
  examples: [
    {
      label: "Rows that go somewhere",
      isWide: true,
      markup: glassPane({ paneSize: "medium", body: listRows({ rows: [
        { title: "Version 14", detail: "2 days ago · 312 files, 48 MB", href: "#list-rows", end: tag("Live", "new") },
        { title: "Version 13", detail: "5 days ago · 309 files, 47 MB", href: "#list-rows", end: "Replaced" },
        { title: "Version 15", detail: "An hour ago · 314 files, 49 MB", href: "#list-rows", end: tag("Held", "warning") },
      ] }) }),
    },
    { label: "Pointed", markup: glassPane({ paneSize: "small", body: listRows({ rows: [{ title: "Ashen Crown", detail: "Unlisted", href: "#list-rows", state: "is-pointed" }] }) }), isStill: true },
    { label: "Keyboard focus", markup: glassPane({ paneSize: "small", body: listRows({ rows: [{ title: "Ashen Crown", detail: "Unlisted", href: "#list-rows", state: "is-focused" }] }) }), isStill: true },
    { label: "Rows that lead on in place, like a report's reasons", markup: glassPane({ paneSize: "small", body: listRows({ rows: [{ title: "It's broken", detail: "Won't load, crashes, or isn't really a game", buttonDataAttributes: { reason: "broken" } }, { title: "Something else", buttonDataAttributes: { reason: "other" } }] }) }) },
    {
      label: "Rows with words to read, like a game's updates",
      markup: glassPane({ paneSize: "medium", body: listRows({ label: "Updates", rows: [
        { title: "Oct 19, 2026", text: "Co-op saves now carry over between hosts.\nThe cave map loads twice as fast on phones." },
        { title: "Oct 11, 2026", text: "Two new caves, and a lantern that lasts the whole night." },
      ] }) }),
    },
    { label: "Rows to read, not to open", markup: glassPane({ paneSize: "small", body: listRows({ rows: [{ title: "Claude", detail: "Made Oct 12 · used an hour ago", end: "Reads, uploads" }, { title: "Build server", detail: "Made Sep 30 · used yesterday", end: "Uploads" }] }) }) },
  ],
});

export interface StateNoteOptions {
  title: string;
  text: string;
  /** What to do about it: a button from Actions. */
  action?: Raw;
}

/** An empty state: what will be here and how it gets here, where a list has nothing yet. */
export function emptyState(options: StateNoteOptions): Raw {
  return html`<div class="state-note"><div class="state-words"><p class="state-title">${options.title}</p><p class="state-text">${options.text}</p></div>${options.action ?? ""}</div>`;
}

const STATE_STYLES = `
/* An empty or problem state: a few words in the middle of where the content would be, what it is and what to do, and at most one
   button for it. Never a picture. */
.state-note { display: grid; justify-items: center; gap: var(--gap-words-control); padding: var(--gap-block-block) 0; text-align: center; }
.state-note > .ico { width: 24px; height: 24px; color: var(--marked); }
.state-words { display: grid; gap: var(--gap-words-words); max-width: 46ch; }
.state-title { margin: 0; font: var(--type-name); color: var(--ink); }
.state-text { margin: 0; font: var(--type-words); color: var(--ink-2); }
`;

component({
  name: "Empty state",
  slug: "empty-state",
  group: "data",
  summary: "Where a list has nothing yet: what will be here, how it gets here, and the button that starts it. In the voice, never a picture.",
  styles: STATE_STYLES,
  render: emptyState,
  examples: [
    { label: "With what starts it", markup: glassPane({ paneSize: "medium", body: emptyState({ title: "No games yet", text: "Make one from your AI, or upload a folder with an index.html from your terminal.", action: runButton("Make a game", { type: "button" }) }) }) },
    { label: "Words alone", markup: glassPane({ paneSize: "small", body: emptyState({ title: "No friends playing", text: "When a friend plays something, it shows here." }) }) },
  ],
});

/** A problem state: what went wrong where the content would be, and what to do (Try again). */
export function problemState(options: StateNoteOptions): Raw {
  return html`<div class="state-note problem">${icon("warning")}<div class="state-words"><p class="state-title">${options.title}</p><p class="state-text">${options.text}</p></div>${options.action ?? ""}</div>`;
}

component({
  name: "Problem state",
  slug: "problem-state",
  group: "data",
  summary: "Where content couldn't come: what went wrong in plain words, and what to do about it, like Try again.",
  styles: "",
  render: problemState,
  examples: [
    { label: "With what to do", markup: glassPane({ paneSize: "medium", body: problemState({ title: "Couldn't load your versions", text: "Zaisma didn't answer in time. Nothing is lost.", action: cutButton("Try again", { type: "button" }) }) }) },
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
.loading-state { display: grid; gap: var(--gap-words-control); justify-items: center; padding: var(--gap-block-block) 0; }
.loading-line { position: relative; display: block; width: min(240px, 100%); height: 2px; overflow: hidden; background: var(--line); }
.loading-line::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--ink) 70%, transparent), transparent); animation: loading-run 1.3s cubic-bezier(.45,0,.25,1) infinite; }
@keyframes loading-run { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.loading-label { font: var(--type-facts); color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .loading-line::after { animation: none; transform: translateX(75%); } }
`,
  render: loadingState,
  examples: [{ label: "Loading", markup: glassPane({ paneSize: "small", body: loadingState({ label: "Getting your versions" }) }) }],
});

export interface TableColumn {
  label: string;
  /** Its label is said only to screen readers: a column of buttons whose words say it (Join). */
  isLabelHidden?: boolean;
  /** Its width, in a table of even columns (isEven): a column of flags or buttons keeps this; the rest share what's left equally. */
  widthPx?: number;
  /** Its heading sorts the rows by its numbers: most first, then fewest first, then back to the table's own order. */
  isSortable?: boolean;
  /** Its cells are numbers: right-aligned, in figures of one width, so a column's digits line up. */
  isNumeric?: boolean;
}

export interface TableOptions {
  /** What the table is, said above it (it stays put as the table scrolls sideways) and to screen readers. */
  caption: string;
  columns: TableColumn[];
  /** One list of cells a row, in the columns' order. */
  rows: (Raw | string)[][];
  /** The one column that stays put as the table scrolls sideways, in the header row's look; a table has one at most. "first": it names
   *  each row (a version, a player), so it's the row's head. "last": its buttons (a room's Join), kept in reach at the right on a phone. */
  headColumn?: "first" | "last";
  /** Closer rows, for long lists (logs, requests). */
  isCompact?: boolean;
  /** Even columns: the table fills its box, columns with a widthPx keep it and the rest share the rest equally, so columns stay put as
   *  rows change (a list that refreshes, like a game's rooms). Words too long for a column end in an ellipsis. It scrolls sideways only
   *  below its columns' widths together (112px for one without its own), and a pinned last column fits its buttons. */
  isEven?: boolean;
  /** Unique on the page. Defaults to a slug of its caption. */
  id?: string;
}

/**
 * A table in a carved well, like the switch's: a header row that stays while its rows scroll under it, hairlines between rows, numbers
 * right-aligned in figures of one width, and at most one head column (headColumn) that stays put as it scrolls sideways: the first,
 * naming the rows, or the last, its buttons. On a phone it scrolls sideways inside its well, fading at its edges, under a caption that
 * stays: a row never folds into a card, since players and developers compare rows. Its well is cut by the edge rule, so its corners follow
 * the pane's where it sits in one.
 */
/** The least a column without its own width takes in a table of even columns: below the sum of them all, the table scrolls sideways. */
const EVEN_COLUMN_MINIMUM_WIDTH_PX = 112;

export function table(options: TableOptions): Raw {
  const id = options.id ?? `table-${options.caption.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const lastIndex = options.columns.length - 1;
  const isRowHead = (columnIndex: number) => options.headColumn === "first" && columnIndex === 0;
  const cellClass = (columnIndex: number) => {
    const classes = [options.columns[columnIndex]?.isNumeric ? "num" : "", options.headColumn === "last" && columnIndex === lastIndex ? "pin" : ""].filter(Boolean).join(" ");
    return classes ? html` class="${classes}"` : "";
  };
  return html`<div class="table"><p class="table-caption" id="${id}-caption">${options.caption}</p><div class="table-well cut-carved" data-cut-line="10">${CUT_LINE}<div class="table-scroll" data-fades-sideways data-side-rail data-scroll-box data-cut-line="8"><table class="data-table${options.isCompact ? " compact" : ""}${options.headColumn === "first" ? " has-row-heads" : ""}${options.isEven ? " even" : ""}" aria-labelledby="${id}-caption"${options.isEven ? html` style="--table-min-width:${options.columns.reduce((widthPx, column) => widthPx + (column.widthPx ?? EVEN_COLUMN_MINIMUM_WIDTH_PX), 0)}px"` : ""}>${options.isEven ? html`<colgroup>${options.columns.map((column) => (column.widthPx ? html`<col style="width:${column.widthPx}px">` : raw("<col>")))}</colgroup>` : ""}<thead><tr>${options.columns.map(
    (column, columnIndex) => html`<th scope="col"${cellClass(columnIndex)}${column.isSortable ? raw(' aria-sort="none"') : ""}>${column.isLabelHidden ? html`<span class="sr">${column.label}</span>` : column.isSortable ? html`<button type="button" class="table-sort">${column.label}${icon("chevron-down")}</button>` : column.label}</th>`,
  )}</tr></thead><tbody>${options.rows.map(
    (row) => html`<tr>${row.map((cell, columnIndex) => (isRowHead(columnIndex) ? html`<th scope="row">${cell}</th>` : html`<td${cellClass(columnIndex)}>${cell}</td>`))}</tr>`,
  )}</tbody></table></div></div></div>`;
}

/**
 * The row under the mouse, lit by the table itself: found where the pointer is on every move and on every scroll (the page's or the
 * table's), so the light stays under the pointer as rows scroll past it, instead of riding up with the row it was on.
 */
export const TABLE_SCRIPT = `/* tables */(function () {
  var lit = null, pointer = null, sorts = new Map();
  // Sorting: by a column's first number, most or fewest first, ties and "none" in the table's own order. A table that's put in again
  // (a refreshed list) keeps the sort it had, by its caption's id.
  function sortRows(table, column, order) {
    var body = table.tBodies[0]; if (!body) return;
    var rows = Array.prototype.slice.call(body.rows);
    rows.forEach(function (row, i) { if (row.dataset.place === undefined) row.dataset.place = i; });
    function numberOf(row) { var found = ((row.cells[column] || {}).textContent || "").match(/-?\\d+(\\.\\d+)?/); return found ? parseFloat(found[0]) : -Infinity; }
    rows.sort(function (a, b) { var place = a.dataset.place - b.dataset.place; return order === "none" ? place : (order === "ascending" ? numberOf(a) - numberOf(b) : numberOf(b) - numberOf(a)) || place; });
    rows.forEach(function (row) { body.appendChild(row); });
    Array.prototype.forEach.call(table.tHead.rows[0].cells, function (head, i) { if (head.hasAttribute("aria-sort")) head.setAttribute("aria-sort", i === column ? order : "none"); });
  }
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest(".table-sort"); if (!button) return;
    var head = button.closest("th"), table = button.closest("table"), now = head.getAttribute("aria-sort");
    var order = now === "descending" ? "ascending" : now === "ascending" ? "none" : "descending";
    sorts.set(table.getAttribute("aria-labelledby"), { column: head.cellIndex, order: order });
    sortRows(table, head.cellIndex, order);
  });
  window.zaismaWatch.each(".data-table", function (table) { var sort = sorts.get(table.getAttribute("aria-labelledby")); if (sort) sortRows(table, sort.column, sort.order); });
  // How wide the head column is, at the left or the right, so the sideways fade and cut start past it.
  window.zaismaWatch.each(".data-table", function (table) {
    var box = table.closest(".table-scroll"), cells = table.tHead && table.tHead.rows[0] && table.tHead.rows[0].cells;
    if (!box || !cells || !cells.length) return;
    var isFirst = table.classList.contains("has-row-heads"), head = isFirst ? cells[0] : cells[cells.length - 1];
    if (!isFirst && !head.classList.contains("pin")) return;
    // A pinned column of buttons is as wide as its widest buttons, no wider, so a phone keeps its room for the rest.
    var col = !isFirst && table.querySelector("colgroup > col:last-child");
    function fit() {
      if (!col) return;
      var style = getComputedStyle(head), widest = 0;
      Array.prototype.forEach.call(table.querySelectorAll("tbody td.pin > *"), function (inside) { widest = Math.max(widest, inside.getBoundingClientRect().width); });
      if (widest) col.style.width = Math.ceil(widest + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)) + "px";
    }
    function measure() { box.style.setProperty(isFirst ? "--table-row-head-w" : "--table-pin-w", head.offsetWidth + "px"); }
    fit(); measure(); window.zaismaWatch.size(head, measure);
  });
  function light(row) { if (lit === row) return; if (lit) lit.classList.remove("is-lit"); lit = row; if (row) row.classList.add("is-lit"); }
  function rowAt(x, y) { var under = document.elementFromPoint(x, y); return under && under.closest(".data-table tbody tr"); }
  document.addEventListener("pointermove", function (event) {
    if (event.pointerType !== "mouse") return;
    pointer = [event.clientX, event.clientY];
    var row = event.target.closest && event.target.closest(".data-table tbody tr");
    if (row) row.closest(".data-table").classList.add("is-tracked");
    light(row);
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", function () { pointer = null; light(null); });
  document.addEventListener("scroll", function () { if (pointer) light(rowAt(pointer[0], pointer[1])); }, { capture: true, passive: true });
})();
`;

const VERSION_ROWS: (Raw | string)[][] = [
  ["Version 15", tag("Held", "warning"), "314", "49.2 MB", "An hour ago"],
  ["Version 14", tag("Live", "new"), "312", "48.1 MB", "Oct 19"],
  ["Version 13", "Replaced", "309", "47.6 MB", "Oct 16"],
  ["Version 12", "Replaced", "296", "45.3 MB", "Oct 11"],
];

component({
  name: "Table",
  slug: "table",
  group: "data",
  summary: "Rows to compare: versions, requests, players, logs. Its header stays as the rows scroll under it, numbers line up on the right, and on a phone it scrolls sideways rather than folding rows into cards.",
  styles: `
/* A table: its caption in a label's words over a carved well, like the switch's, that it scrolls inside. Nothing in it is glass: its
   header row and the column that names the rows sit in the well itself, in the same words, with a hairline between them and the rows. */
.table { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; row-gap: var(--gap-words-control); min-width: 0; --table-head-h: 38px; }
.table:has(.data-table.compact) { --table-head-h: 34px; }
.table > .table-caption { grid-row: 1; grid-column: 1; }
.table > .table-well { grid-row: 2; grid-column: 1; }
/* Its rails, outside the well: up and down beside its right edge, from the header's foot down, and sideways under it. */
.table > .rail[data-rail="box"] { position: relative; grid-row: 2; grid-column: 2; top: auto; right: auto; bottom: auto; margin: calc(var(--table-head-h) + 4px) 0 4px 4px; }
.table > .rail.sideways { grid-row: 3; grid-column: 1; }
.table-caption { margin: 0; font: var(--type-label); color: var(--ink); }
.table-well { position: relative; display: flex; min-width: 0; padding: 4px; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
.table-scroll { position: relative; flex: 1; min-width: 0; clip-path: var(--cut-shape); }
/* A long table scrolls inside its well, at most --table-height tall (a page sets it where the table shares the screen, like a game's rooms). */
.table-scroll[data-fades-sideways] { overflow-y: auto; max-height: var(--table-height, min(640px, 75dvh)); }
.data-table { width: 100%; min-width: max-content; border-collapse: separate; border-spacing: 0; font: var(--type-words); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.data-table th, .data-table td { white-space: nowrap; text-align: left; }
/* A column whose label is said only to screen readers (its buttons say it). */
.data-table th > .sr { position: absolute; }
/* The header row and the head column: one look, the well's own, in the header's quieter words. The header stays at the top and the head
   column at the left (the rows' heads) or the right (a pinned column of buttons); a hairline marks where the rows slide under them. */
.data-table thead th, .data-table tbody th { font: var(--type-facts); color: var(--muted); }
.data-table thead th { position: sticky; top: 0; z-index: 2; box-sizing: border-box; height: var(--table-head-h); padding: 10px 16px; box-shadow: inset 0 -1px 0 var(--line); }
.data-table td, .data-table tbody th { padding: 14px 16px; border-top: var(--divider); }
.data-table tbody tr:first-child > * { border-top: 0; }
.data-table tbody th { position: sticky; left: 0; z-index: 1; }
.data-table.has-row-heads thead th:first-child { left: 0; z-index: 3; }
.data-table .pin { position: sticky; right: 0; z-index: 1; }
.data-table thead .pin { z-index: 3; }
.table-scroll.is-scrollable-sideways .data-table tbody th { box-shadow: inset -1px 0 0 var(--line); }
.table-scroll.is-scrollable-sideways .data-table.has-row-heads thead th:first-child { box-shadow: inset 0 -1px 0 var(--line), inset -1px 0 0 var(--line); }
.table-scroll.is-scrollable-sideways .data-table tbody .pin { box-shadow: inset 1px 0 0 var(--line); }
.table-scroll.is-scrollable-sideways .data-table thead .pin { box-shadow: inset 0 -1px 0 var(--line), inset 1px 0 0 var(--line); }
.data-table td:first-child { color: var(--ink); }
.data-table code { font: var(--type-code); }
.data-table .num { text-align: right; }
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
.data-table.even td, .data-table.even tbody th { overflow: hidden; text-overflow: ellipsis; }
/* Buttons in a cell keep their own widths, side by side (a room's Join, and its flat Report). */
.data-table td > .control-row { display: inline-flex; flex-wrap: nowrap; vertical-align: middle; }
[data-glass] .data-table td > .control-row > .shell { flex: none; }
/* The row under the pointer, its head and pinned cells too: TABLE_SCRIPT lights it (is-lit) and finds it again as the rows scroll, since
   the browser's own hover keeps the row it lit until the pointer moves; without the script, the browser's hover does. */
.data-table:not(.is-tracked) tbody tr:hover > *, .data-table tbody tr.is-lit > * { background-image: linear-gradient(var(--row-hover), var(--row-hover)); }
.data-table.compact thead th { padding: 8px 12px; }
.data-table.compact td, .data-table.compact tbody th { padding: 8px 12px; }
.data-table.compact td { font: var(--type-facts); }
/* What scrolls fades into the well before it reaches the header or the head column, and is gone by the time anything in it would pass
   under: the edge fades below fade it on its way to their hairline, and a row (or a column) that starts to pass under turns clear over
   its cell's own padding, empty room, so its words and buttons never show through. Only opacity moves, on the browser's own scrolling,
   so it keeps up with the quickest scroll. Each one's view of the box is inset by the header's height (--table-head-h), or the heads' or
   the pinned column's width (--table-row-head-w, --table-pin-w); the crossing ranges keep to the cell's own size. */
.data-table { --cell-room-y: 14px; --cell-room-x: 16px; }
.data-table.compact { --cell-room-y: 8px; --cell-room-x: 12px; }
@supports (animation-timeline: view()) {
  .data-table tbody tr { animation: table-gone linear both; animation-timeline: view(block var(--table-head-h) 0px); animation-range: exit-crossing 0px exit-crossing var(--cell-room-y); }
  .data-table.has-row-heads :is(thead th:not(:first-child), tbody td) { animation: table-gone linear both; animation-timeline: view(inline var(--table-row-head-w, 0px) 0px); animation-range: exit-crossing 0px exit-crossing var(--cell-room-x); }
  .data-table:has(.pin) :is(thead th, tbody td):not(.pin) { animation: table-back linear both; animation-timeline: view(inline 0px var(--table-pin-w, 0px)); animation-range: entry-crossing calc(100% - var(--cell-room-x)) entry-crossing 100%; }
}
/* A browser that can't fade them gives the header and the head column the well's color, solid, to hide what's under them. */
@supports not (animation-timeline: view()) {
  .data-table thead th, .data-table tbody th, .data-table .pin { background-color: var(--table-row-head); }
}
@keyframes table-gone { from { opacity: 1; } to { opacity: 0; } }
@keyframes table-back { from { opacity: 0; } to { opacity: 1; } }
/* With more above, below or to a side, what scrolls fades into the well just past the header, the heads and the pinned column and at its
   other edges. Each fade is all there or not at all, set by whether there's more that way (more-up and more-down from SCROLL_FADE_SCRIPT,
   more-left and more-right from the sideways fade), so it sits still while the rows scroll through it. The header, the head column and
   the well itself never fade. */
@property --table-fade-top { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --table-fade-bottom { syntax: "<length>"; inherits: false; initial-value: 0px; }
.table-scroll.more-up { --table-fade-top: 28px; }
.table-scroll.more-down { --table-fade-bottom: 28px; }
.table-scroll.is-fading { --fade-rows: linear-gradient(to bottom, #000 var(--table-head-h), transparent var(--table-head-h), #000 calc(var(--table-head-h) + var(--table-fade-top)), #000 calc(100% - var(--table-fade-bottom)), transparent);
  -webkit-mask-image: var(--fade-rows); mask-image: var(--fade-rows); transition: --table-fade-top 0.2s, --table-fade-bottom 0.2s, --fade-left 0.25s, --fade-right 0.25s; }
.table-scroll { --fade-columns: linear-gradient(90deg, #000 var(--table-row-head-w, 0px), transparent var(--table-row-head-w, 0px), #000 calc(var(--table-row-head-w, 0px) + var(--fade-left)),
  #000 calc(100% - var(--table-pin-w, 0px) - var(--fade-right)), transparent calc(100% - var(--table-pin-w, 0px)), #000 calc(100% - var(--table-pin-w, 0px))); }
.table-scroll:is(.more-left, .more-right) { -webkit-mask-image: var(--fade-columns); mask-image: var(--fade-columns); }
.table-scroll.is-fading:is(.more-left, .more-right) {
  -webkit-mask-image: var(--fade-rows), var(--fade-columns); -webkit-mask-composite: source-in;
  mask-image: var(--fade-rows), var(--fade-columns); mask-composite: intersect; }
`,
  render: table,
  examples: [
    {
      label: "Versions",
      isWide: true,
      markup: glassPane({ paneSize: "full", body: table({ caption: "Versions", headColumn: "first", columns: [{ label: "Version" }, { label: "State" }, { label: "Files", isNumeric: true, isSortable: true }, { label: "Size", isNumeric: true, isSortable: true }, { label: "Made" }], rows: VERSION_ROWS }) }),
    },
    {
      label: "Compact, for long lists",
      isWide: true,
      markup: glassPane({ paneSize: "full", body: table({
        caption: "Requests to your game server",
        isCompact: true,
        columns: [{ label: "When" }, { label: "Route" }, { label: "Status", isNumeric: true }, { label: "Took", isNumeric: true }],
        rows: [
          ["14:02:11", html`<code>POST /match/start</code>`, "200", "38 ms"],
          ["14:02:09", html`<code>GET /leaderboard</code>`, "200", "12 ms"],
          ["14:01:57", html`<code>POST /match/end</code>`, "409", "21 ms"],
          ["14:01:40", html`<code>GET /inventory</code>`, "200", "9 ms"],
          ["14:01:22", html`<code>POST /trade</code>`, "429", "2 ms"],
        ],
      }) }),
    },
    {
      label: "A list to join from, its height set by the page, its Join pinned",
      isWide: true,
      markup: html`<div style="--table-height:240px">${glassPane({ paneSize: "full", body: table({
        caption: "Open rooms",
        isCompact: true,
        headColumn: "last",
        isEven: true,
        columns: [{ label: "Room", widthPx: 160 }, { label: "Mode" }, { label: "Where", widthPx: 64 }, { label: "Players", isNumeric: true, widthPx: 88, isSortable: true }, { label: "Join", isLabelHidden: true, widthPx: 80 }],
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
    (numberItem) => html`<div class="number"><dt>${numberItem.label}</dt><dd class="number-figure">${numberItem.figure}${numberItem.unit ? html`<span class="number-unit">${numberItem.unit}</span>` : ""}</dd>${numberItem.change ? html`<dd class="number-change${numberItem.isChangeGood ? " good" : ""}">${numberItem.change}</dd>` : ""}</div>`,
  )}</dl>`;
}

component({
  name: "Numbers",
  slug: "numbers",
  group: "data",
  summary: "A row of figures to take in at a glance: players, hours, plays. Each figure is big, its label sits under it, and how it moved is green when it's good news.",
  styles: `
/* Numbers: big figures in Jost with figures of one width, their unit smaller beside them, the label under each in facts. They share the row,
   wrapping on a phone. */
.numbers { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: var(--gap-block-block); margin: 0; }
.number { display: grid; gap: var(--gap-words-words); align-content: start; }
.number dt { order: 2; font: var(--type-facts); color: var(--muted); }
.number dd { margin: 0; }
.number-figure { order: 1; font: var(--type-heading); color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.number-unit { margin-left: var(--gap-words-words); font: var(--type-label); color: var(--ink-2); }
.number-change { order: 3; font: var(--type-facts); color: var(--ink-2); }
.number-change.good { color: var(--tag-new-ink); }
`,
  render: numbers,
  examples: [
    {
      label: "This week",
      isWide: true,
      markup: glassPane({ paneSize: "full", body: numbers({ items: [
        { label: "Players", figure: "1,284", change: "+18% on last week", isChangeGood: true },
        { label: "Hours played", figure: "3,906", unit: "hours", change: "+6% on last week", isChangeGood: true },
        { label: "Plays", figure: "9,412", change: "−3% on last week" },
        { label: "Stored", figure: "48.1", unit: "MB" },
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
  points: ChartPoint[];
  /** What the numbers count, said with each one: "plays". */
  unit: string;
  /** A line over time (the default), bars over time, one a point, or a ring of shares of a whole. */
  chartKind?: "line" | "bars" | "ring";
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

/**
 * A chart, drawn here as SVG, so there's nothing to wait for. Over time, a line or bars on a hairline grid in round steps, its numbers in a
 * column of their own at the left so nothing drawn crosses them, the line (or bars) in ink and the last point in orange with its number.
 * Pointing at a point shows its number. On a narrow screen every point keeps its room and the chart scrolls sideways, starting at the latest.
 * A table with the same numbers sits behind it for screen readers (in a hidden box: a table never shrinks to one).
 * A ring shows shares of a whole: each share a part of the ring, the biggest darkest, with a key of names, shares and numbers beside it.
 */
export function chart(options: ChartOptions): Raw {
  if (options.chartKind === "ring") return ringChart(options);
  const widthNumber = 1000, heightNumber = 300, points = options.points;
  const topNumber = chartTopNumber(Math.max(...points.map((point) => point.amountNumber), 0));
  const isBars = options.chartKind === "bars";
  const slotNumber = widthNumber / Math.max(points.length, 1);
  const acrossNumber = (pointIndex: number) => (isBars ? slotNumber * (pointIndex + 0.5) : points.length > 1 ? (pointIndex / (points.length - 1)) * widthNumber : widthNumber / 2);
  const downNumber = (amountNumber: number) => heightNumber - (amountNumber / topNumber) * heightNumber;
  const acrossPct = (pointIndex: number) => ((acrossNumber(pointIndex) / widthNumber) * 100).toFixed(2);
  const downPct = (amountNumber: number) => ((downNumber(amountNumber) / heightNumber) * 100).toFixed(2);
  const line = points.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${acrossNumber(pointIndex).toFixed(1)} ${downNumber(point.amountNumber).toFixed(1)}`).join(" ");
  const drawing = isBars
    ? points.map((point, pointIndex) => {
        const barHeightNumber = Math.max(heightNumber - downNumber(point.amountNumber), 1);
        return raw(`<rect class="chart-bar${pointIndex === points.length - 1 ? " last" : ""}" x="${(slotNumber * pointIndex + slotNumber * 0.18).toFixed(1)}" y="${(heightNumber - barHeightNumber).toFixed(1)}" width="${(slotNumber * 0.64).toFixed(1)}" height="${barHeightNumber.toFixed(1)}"/>`);
      })
    : raw(`<path class="chart-line" d="${line}" vector-effect="non-scaling-stroke"/>`);
  const area = isBars ? "" : raw(`<svg class="chart-drawing chart-area-drawing" viewBox="0 0 ${widthNumber} ${heightNumber}" preserveAspectRatio="none"><path class="chart-area" d="${line} L${acrossNumber(points.length - 1).toFixed(1)} ${heightNumber} L${acrossNumber(0).toFixed(1)} ${heightNumber} Z"/></svg>`);
  const last = points[points.length - 1];
  const lastMark = last
    ? html`<span class="chart-last${isBars ? " is-bar" : ""}" style="left:${acrossPct(points.length - 1)}%;top:${downPct(last.amountNumber)}%"><span class="chart-last-words">${chartWords(last.amountNumber)}</span></span>`
    : "";
  // Where the pointer finds each point: a column round it, as wide as the room between points, holding its dot and its number.
  // The first and last stop at the plot's ends, so nothing reaches past it to make it scroll.
  const hitWidthPct = 100 / Math.max(isBars ? points.length : points.length - 1, 1);
  const hits = points.map((point, pointIndex) => {
    // Its number opens toward the middle of the chart, so it stays inside it.
    const place = pointIndex >= points.length / 2 ? " is-end" : "";
    const centerPct = (acrossNumber(pointIndex) / widthNumber) * 100, leftPct = Math.max(0, centerPct - hitWidthPct / 2), rightPct = Math.min(100, centerPct + hitWidthPct / 2);
    return html`<span class="chart-hit${place}" style="left:${leftPct.toFixed(2)}%;width:${(rightPct - leftPct).toFixed(2)}%;--point-left:${(((centerPct - leftPct) / Math.max(rightPct - leftPct, 0.01)) * 100).toFixed(2)}%;--point-top:${downPct(point.amountNumber)}%"><span class="chart-dot"></span><span class="chart-tip"><b>${chartWords(point.amountNumber)} ${options.unit}</b><span>${point.label}</span></span></span>`;
  });
  const grid = [1, 0.5, 0];
  return html`<figure class="chart"><figcaption class="chart-label">${options.label}</figcaption><div class="chart-body" aria-hidden="true"><div class="chart-scale">${grid.map(
    (shareNumber) => html`<span style="top:${((1 - shareNumber) * 100).toFixed(0)}%">${scaleWords(topNumber * shareNumber)}</span>`,
  )}</div><div class="chart-scroll" data-fades-sideways data-side-rail data-chart-scroll><div class="chart-inner${isBars ? " is-bars" : ""}" style="--point-count:${points.length}"><div class="chart-plot">${grid.map(
    (shareNumber) => html`<span class="chart-grid" style="top:${((1 - shareNumber) * 100).toFixed(0)}%"></span>`,
  )}${area}<svg class="chart-drawing" viewBox="0 0 ${widthNumber} ${heightNumber}" preserveAspectRatio="none">${drawing}</svg>${lastMark}${hits}</div><div class="chart-axis"><span>${points[0]?.label ?? ""}</span><span>${last?.label ?? ""}</span></div></div></div></div><div class="sr"><table><caption>${options.label}</caption><tbody>${points.map(
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

/** A chart that scrolls sideways starts at its latest points. */
export const CHART_SCRIPT = `/* charts */(function () {
  document.querySelectorAll("[data-chart-scroll]").forEach(function (scroll) { scroll.scrollLeft = scroll.scrollWidth; });
})();
`;

const DAILY_PLAYS: ChartPoint[] = [812, 904, 870, 1012, 1190, 1460, 1384, 1102, 1056, 1218, 1305, 1520, 1712, 1655].map((amountNumber, dayIndex) => ({ label: `Oct ${8 + dayIndex}`, amountNumber }));
const MONTHLY_PLAYERS: ChartPoint[] = [3120, 3480, 4210, 3990, 4620, 5310, 6870, 7420, 6980, 8130, 9760, 11240, 12480, 11920, 13650, 15210, 16880, 18420, 17950, 21300, 23870, 26420, 25110, 28940].map((amountNumber, weekIndex) => ({ label: `Week ${weekIndex + 1}`, amountNumber }));
const SHARE_RING_CSS = [0, 1, 2, 3, 4, 5, 6, 7]
  .map((shareIndex) => `.ring:has(.ring-key [data-share="${shareIndex}"]:hover) .ring-part[data-share="${shareIndex}"], .ring:has(.ring-part[data-share="${shareIndex}"]:hover) .ring-part[data-share="${shareIndex}"] { stroke: var(--run); }
.ring:has(.ring-part[data-share="${shareIndex}"]:hover) .ring-key [data-share="${shareIndex}"] { background: var(--row-hover); }`)
  .join("\n");

component({
  name: "Chart",
  slug: "chart",
  group: "data",
  summary: "How something moved over time, drawn on the page with nothing to wait for: a line or bars on a hairline grid, the last point in orange with its number, and any point's number where you point. Or how a whole splits, as a ring with its key. Screen readers get the same numbers.",
  styles: `
/* A chart over time: its label, then its scale's numbers in a column of their own and the plot beside it, the first and last points' labels
   under the plot. The drawing stretches to the plot while its line keeps its 2px. On a narrow screen each point keeps at least its room
   (--point-room) and the plot scrolls sideways under a scale that stays. The last point is an orange dot with its number over it; pointing at
   any point shows its dot and its number (a bar's column brightens), its words kept inside the plot at the ends. */
.chart { display: grid; gap: var(--gap-words-control); margin: 0; min-width: 0; }
.chart-label { font: var(--type-label); color: var(--ink); }
.chart-body { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--gap-words-control); margin-top: var(--gap-block-block); }
.chart-scale { position: relative; height: 180px; min-width: 32px; font: var(--type-facts); color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
.chart-scale > span { position: absolute; right: 0; transform: translateY(-50%); white-space: nowrap; }
.chart-scroll { min-width: 0; padding-top: var(--gap-block-block); margin-top: calc(-1 * var(--gap-block-block)); }
/* Its dots at the ends keep their whole round inside its padding; anything else past its sides is clipped, never making it scroll. */
.chart-inner { --point-room: 14px; min-width: calc(var(--point-count) * var(--point-room)); padding: 0 6px; overflow-x: clip; }
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
.chart-bar.last { fill: var(--run); }
.chart-last { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; background: var(--run); border-radius: 50%; box-shadow: 0 0 0 3px var(--chart-ring); pointer-events: none; }
.chart-last.is-bar { width: 0; height: 0; margin: 0; box-shadow: none; }
.chart-last-words { position: absolute; right: 0; bottom: 14px; font: var(--type-label); color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; transition: opacity 0.15s; }
.chart-last.is-bar .chart-last-words { right: auto; left: 0; bottom: 6px; transform: translateX(-50%); }
.chart-body > .rail { grid-column: 2; }
.chart-axis { display: flex; justify-content: space-between; padding-top: var(--gap-words-control); font: var(--type-facts); color: var(--muted); }
.chart-hit { position: absolute; top: 0; bottom: 0; z-index: 2; }
.chart-inner.is-bars .chart-hit:hover { background: var(--row-hover); }
.chart-dot { position: absolute; left: var(--point-left); top: var(--point-top); width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--ink); box-shadow: 0 0 0 3px var(--chart-ring); opacity: 0; transition: opacity 0.15s; }
.chart-inner.is-bars .chart-dot { display: none; }
.chart-tip { position: absolute; left: var(--point-left); bottom: calc(100% - var(--point-top) + 12px); transform: translateX(-12px); display: grid; padding: 4px 8px; white-space: nowrap;
  font: var(--type-facts); color: var(--ink-2); background: var(--chart-tip); box-shadow: var(--slab-shade); opacity: 0; transition: opacity 0.15s; pointer-events: none; }
.chart-tip b { font-weight: 600; color: var(--ink); }
.chart-hit.is-end .chart-tip { transform: translateX(calc(-100% + 12px)); }
.chart-hit:hover .chart-dot, .chart-hit:hover .chart-tip { opacity: 1; }
.chart-plot:has(.chart-hit:last-child:hover) .chart-last-words { opacity: 0; }
/* A ring: the shares round a ring, biggest first and darkest, each lighter after; the whole in its middle. Its key beside it (under it on a
   phone) names each with its share and number. Pointing at a part or its line in the key turns that part orange and brightens its line. */
.ring-body { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--gap-block-block); }
.ring-picture { position: relative; flex: none; width: 168px; height: 168px; }
.ring-drawing { width: 100%; height: 100%; }
.ring-part { fill: none; stroke-width: 16; stroke: var(--share-color); transition: stroke 0.15s; cursor: default; }
.ring-total { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; font: var(--type-facts); color: var(--muted); }
.ring-total b { font: var(--type-section); color: var(--ink); font-variant-numeric: tabular-nums; }
.ring-key { flex: 1 1 220px; list-style: none; margin: 0; padding: 0; display: grid; }
.ring-key li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: var(--gap-words-control); padding: var(--gap-words-words) var(--gap-words-words); font: var(--type-words); color: var(--ink); }
.ring-key li:hover { background: var(--row-hover); }
.ring-key li + li { border-top: var(--divider); }
.ring-swatch { width: 12px; height: 12px; background: var(--share-color); }
.ring-share { font-weight: 600; font-variant-numeric: tabular-nums; }
.ring-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
    { label: "A line: plays a day", isWide: true, markup: glassPane({ paneSize: "full", body: chart({ label: "Plays a day", points: DAILY_PLAYS, unit: "plays" }) }) },
    { label: "Bars: players a day", isWide: true, markup: glassPane({ paneSize: "full", body: chart({ label: "Players a day", points: DAILY_PLAYS.map((point) => ({ label: point.label, amountNumber: Math.round(point.amountNumber * 0.31) })), unit: "players", chartKind: "bars" }) }) },
    { label: "Many points: on a phone, it scrolls sideways from the latest", isWide: true, markup: glassPane({ paneSize: "full", body: chart({ label: "Players a week", points: MONTHLY_PLAYERS, unit: "players", chartKind: "bars" }) }) },
    {
      label: "A ring: how a whole splits",
      isWide: true,
      markup: glassPane({ paneSize: "full", body: chart({ label: "Players by browser", unit: "players", chartKind: "ring", points: [
        { label: "Chrome", amountNumber: 6120 }, { label: "Safari", amountNumber: 3480 }, { label: "Edge", amountNumber: 1210 }, { label: "Firefox", amountNumber: 860 }, { label: "Others", amountNumber: 330 },
      ] }) }),
    },
  ],
});

export interface UsageMeterOptions {
  label: string;
  usedNumber: number;
  limitNumber: number;
  /** What's counted, after the numbers: "player-hours", "MB". */
  unit: string;
}

/**
 * A usage meter: a carved track filling in quiet ink, amber from 80%. All used, it's unmistakable: the fill is striped amber across the
 * whole track, a warning mark leads its label, and its numbers end in "all used".
 */
export function usageMeter(options: UsageMeterOptions): Raw {
  const sharePct = Math.min(100, Math.round((options.usedNumber / Math.max(options.limitNumber, 1)) * 100));
  const isAllUsed = options.usedNumber >= options.limitNumber;
  const tone = isAllUsed ? " is-full" : sharePct >= 80 ? " is-near" : "";
  return html`<div class="usage${tone}"><div class="usage-words"><span class="usage-label">${isAllUsed ? icon("warning") : ""}${options.label}</span><span class="usage-numbers">${chartWords(options.usedNumber)} of ${chartWords(options.limitNumber)} ${options.unit}${isAllUsed ? html`<b>, all used</b>` : ""}</span></div><div class="usage-track cut-carved" data-cut-line="6" role="meter" aria-label="${options.label}" aria-valuemin="0" aria-valuemax="${options.limitNumber}" aria-valuenow="${Math.min(options.usedNumber, options.limitNumber)}">${CUT_LINE}<span class="usage-fill" data-cut-line="4" style="width:${sharePct}%"></span></div></div>`;
}

component({
  name: "Usage meter",
  slug: "usage-meter",
  group: "data",
  summary: "How much of an allowance is used: player-hours, requests, storage. A carved track fills in ink, turns amber from 80%, and says so when it's all used.",
  styles: `
/* A usage meter: its label and numbers on one line, the track under it, a carved strip the fill grows along. The fill is a quiet ink,
   amber from 80%; all used, it's amber striped with a deeper amber, like tape across a door, and a warning mark leads the label. */
.usage { display: grid; gap: var(--gap-words-words); }
.usage-words { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 var(--gap-words-control); }
.usage-label { display: inline-flex; align-items: center; gap: var(--gap-words-words); font: var(--type-label); color: var(--ink); }
.usage-label > .ico { width: 16px; height: 16px; color: var(--meter-full-ink); }
.usage-numbers { font: var(--type-facts); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.usage-numbers b { font-weight: 600; color: var(--meter-full-ink); }
.usage-track { position: relative; height: 12px; padding: 3px; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
.usage-fill { display: block; height: 100%; background: var(--meter-fill); clip-path: var(--cut-shape); transition: width 0.6s var(--spring); }
.usage.is-near .usage-fill { background: var(--meter-near); }
.usage.is-full .usage-fill { background: repeating-linear-gradient(-45deg, var(--meter-near) 0 6px, var(--meter-full) 6px 12px); }
`,
  render: usageMeter,
  examples: [
    { label: "Under way", markup: glassPane({ paneSize: "small", body: usageMeter({ label: "Player-hours this month", usedNumber: 412.6, limitNumber: 1000, unit: "hours" }) }) },
    { label: "Past 80%", markup: glassPane({ paneSize: "small", body: usageMeter({ label: "Requests this month", usedNumber: 86200, limitNumber: 100000, unit: "requests" }) }) },
    { label: "All used", markup: glassPane({ paneSize: "small", body: usageMeter({ label: "Stored", usedNumber: 500, limitNumber: 500, unit: "MB" }) }) },
  ],
});
