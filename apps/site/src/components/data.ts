import { accountPicture, html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { cutButton, runButton, textLink } from "./actions.ts";
import { CUT_LINE, MINUTE_MS, ago, glassPane, icon, tag, type TagTone } from "./foundations.ts";

/*
 * Data: an account's picture in its cut frame, and the glance list, one line per fact, each in its own look.
 * From the header draft (the face in the account button) and the home draft (the pane's glance list).
 */

export type PictureSize = "xs" | "sm" | "md";

/**
 * An account's picture (accountPicture, its initials for now) in a small frame of the panes' glass, with its drawn rim. Pictures are the
 * one thing never cut or slanted: always square, alone or in a row, wherever they sit.
 */
export function pictureFrame(username: string, pictureSize: PictureSize, options: { presence?: "online" | "playing" } = {}): Raw {
  const frame = html`<span class="frame ${pictureSize} glass" data-glass data-glass-corners="0 0 0 0" data-glass-band="2" aria-hidden="true"><span class="frame-picture">${accountPicture(username, pictureSize, { title: "" })}</span></span>`;
  // The glass is clipped to its edge, so the presence marks sit outside it: a green line along its foot, and for playing a green tab with a play mark at the line's end.
  return options.presence
    ? html`<span class="frame-presence ${pictureSize}">${frame}<span class="presence-line" aria-hidden="true"></span>${options.presence === "playing" ? html`<span class="presence-play" aria-hidden="true">${icon("play")}</span>` : ""}</span>`
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


export interface ListRow {
  title: string;
  /** A line under its title, in quiet words. */
  detail?: string;
  /** Where the row goes: the whole row is the link. */
  href?: string;
  /** What sits at its end: a Tag or a few words. Never a button in a row that's a link. */
  end?: Raw | string;
  /** The gallery's fixed states. */
  state?: "is-pointed" | "is-focused";
}

/** List rows: a list on glass, one thing a row with hairlines between (versions, keys, topics, players); a row with an address is a link as a whole. */
export function listRows(options: { rows: ListRow[]; id?: string; label?: string }): Raw {
  return html`<ul class="list-rows"${options.id ? html` id="${options.id}"` : ""}${options.label ? html` aria-label="${options.label}"` : ""}>${options.rows.map((row) => {
    const inside = html`<span class="list-row-words"><span class="list-row-title">${row.title}</span>${row.detail ? html`<span class="list-row-detail">${row.detail}</span>` : ""}</span>${row.end !== undefined ? html`<span class="list-row-end">${row.end}</span>` : ""}`;
    return html`<li>${row.href ? html`<a class="list-row is-link${row.state ? ` ${row.state}` : ""}" href="${row.href}" data-cut-line="8">${CUT_LINE}${inside}<span class="list-row-go" aria-hidden="true">${icon("chevron-right")}</span></a>` : html`<div class="list-row">${inside}</div>`}</li>`;
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
.list-row.is-link { --face-color: transparent; background: var(--face-color); clip-path: var(--cut-shape); transition: --face-color 0.15s; -webkit-tap-highlight-color: transparent; }
.list-row > :not(.cut-line) { position: relative; z-index: 2; }
.list-row-words { display: grid; gap: var(--gap-words-words); min-width: 0; flex: 1; }
.list-row-title { font: var(--type-label); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-row-detail { font: var(--type-facts); color: var(--muted); }
.list-row-end { flex: none; display: inline-flex; align-items: center; gap: var(--gap-words-words); font: var(--type-facts); color: var(--ink-2); }
.list-row-go { flex: none; display: inline-flex; color: var(--muted); transition: transform 0.45s cubic-bezier(.2,.7,.2,1), color 0.2s; }
.list-row-go > .ico { width: 8px; height: 13px; stroke-width: 2.2; }
/* The mark at its start: a short orange bar, cut at its ends, growing from its middle. */
.list-row.is-link::before { content: ""; position: absolute; z-index: 2; left: 4px; top: 30%; bottom: 30%; width: 3px; background: var(--run); transform: scaleY(0); transition: transform 0.3s cubic-bezier(.2,.8,.2,1); }
.list-row.is-link:hover, .list-row.is-link.is-pointed { --face-color: var(--ghost); }
.list-row.is-link:hover::before, .list-row.is-link.is-pointed::before, .list-row.is-link:focus-visible::before { transform: scaleY(1); }
.list-row.is-link:hover > .list-row-go, .list-row.is-link.is-pointed > .list-row-go { transform: translateX(3px); color: var(--ink); }
.list-row.is-link:active { --face-color: var(--wash-press); }
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
