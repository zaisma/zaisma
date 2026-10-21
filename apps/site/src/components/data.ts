import { accountPicture, html, raw, type Raw } from "../html.ts";
import { component } from "./component.ts";
import { textLink } from "./actions.ts";
import { CUT_LINE, MINUTE_MS, ago, icon, tag, type TagTone } from "./foundations.ts";

/*
 * Data: an account's picture in its cut frame, and the glance list, one line per fact, each in its own look.
 * From the header draft (the face in the account button) and the home draft (the pane's glance list).
 */

/** An account's picture (accountPicture, its initials for now) in the cut frame: near-white on light glass, darkened on smoked. Its shape is the edge rule's, like a control's. */
export function pictureFrame(username: string, pictureSize: "xs" | "sm" | "md", options: { isOnline?: boolean } = {}): Raw {
  return html`<span class="frame ${pictureSize}${options.isOnline ? " is-online" : ""}" data-cut-line="10" aria-hidden="true">${CUT_LINE}${accountPicture(username, pictureSize, { title: "" })}</span>`;
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
    friends.length ? html`<li class="friends"><span class="faces control-row">${friends.map((friend) => pictureFrame(friend.username, "xs"))}</span><span><b>${nameList(friends.map((friend) => friend.username))}</b> ${friends.length > 1 ? "are" : "is"} playing</span></li>` : ""
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
/* Faces are a .control-row, so they slant toward each other by the edge rule like controls in a row. */
.faces { display: inline-flex; flex: none; flex-wrap: nowrap; }
`;

component({
  name: "Picture frame",
  slug: "picture-frame",
  group: "data",
  summary: "An account's picture, always in its cut frame: in the account button, beside a friend's name, on a profile.",
  styles: `
/* An account's picture in a cut frame: a ring of the glass's own light (near-white on light glass, darkened on smoked) around the picture.
   Its shape is the edge rule's (--cut-shape), never corners of its own: square in the middle of a pane, cut where it meets a corner, slanted beside another. */
.frame { --frame: 38px; position: relative; isolation: isolate; display: inline-grid; place-items: center; width: var(--frame); height: var(--frame); flex: none; }
.frame.sm { --frame: 30px; }
.frame.xs { --frame: 22px; }
.frame > .cut-line polygon { stroke: var(--face-ring); stroke-width: 2; }
.frame .av { position: absolute; inset: 0; display: grid; place-items: center; font: 600 calc(var(--frame) * 0.4) var(--display); color: #fff; letter-spacing: 0.01em;
  background: linear-gradient(140deg, hsl(var(--h) 58% 58%), hsl(calc(var(--h) + 45) 48% 52%) 55%, hsl(calc(var(--h) + 90) 48% 55%));
  clip-path: var(--cut-shape); }
/* Online: a small green diamond on the picture's corner, ringed in the glass's light. */
.frame.is-online::after { content: ""; position: absolute; z-index: 2; right: -2px; bottom: -2px; width: 11px; height: 11px; background: var(--online); border: 2px solid var(--presence-ring); transform: rotate(45deg); }
/* The smallest shows only the first letter, as the drafts' friends' pictures do. */
.frame.xs .av { display: block; text-align: center; line-height: var(--frame); font-size: 0; }
.frame.xs .av::first-letter { font-size: 11px; }
`,
  render: pictureFrame,
  examples: [
    { label: "Big", markup: pictureFrame("emma_r", "md") },
    { label: "Online", markup: pictureFrame("emma_r", "md", { isOnline: true }) },
    { label: "Small", markup: pictureFrame("Liam", "sm") },
    { label: "Smallest, in a row", markup: html`<span class="faces control-row">${["Liam", "Sofia", "Noah", "Mia"].map((name) => pictureFrame(name, "xs"))}</span>` },
  ],
});

component({
  name: "Tag",
  slug: "tag",
  group: "data",
  summary: "A few words or a number on what they label, slanted at both ends: Updated on a game, the count of unread topics on a place, a mark's name on the rail.",
  styles: `
/* A tag: slanted at both ends, in --type-tag. Its tone says what it is: new (green), a count (the buttons' face), or glass (the menus' glass, over the page). */
.tag { display: inline-flex; align-items: center; justify-content: center; height: 22px; min-width: 22px; padding: 0 10px 0 9px; flex: none; white-space: nowrap;
  font: var(--type-tag); clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); }
.tag.new { color: var(--tag-new-ink); background: var(--tag-new); }
.tag.count { padding: 0 8px; color: var(--ink-2); background: var(--btn); font-variant-numeric: tabular-nums; }
.tag.glass { color: var(--ink); --glass-tint: var(--glass-dropdown); }
`,
  render: (words: string | number, tone: TagTone) => tag(words, tone),
  examples: [
    { label: "New", markup: tag("Updated", "new") },
    { label: "A count", markup: tag(3, "count") },
    { label: "On glass", markup: tag("Continue playing", "glass") },
  ],
});

const HOUR_MS = 60 * MINUTE_MS;
const glancePane = (body: Raw) => html`<div class="glass example-pane" data-glass data-glass-corners="24 20 24 20">${body}</div>`;

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

