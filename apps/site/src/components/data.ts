import { accountPicture, html, raw, type Raw } from "../html.ts";
import { component } from "./component.ts";
import { MINUTE_MS, ago, icon } from "./foundations.ts";

/*
 * Data: an account's picture in its cut frame, and the glance list, one line per fact, each in its own look.
 * From the header draft (the face in the account button) and the home draft (the pane's glance list).
 */

/** An account's picture (accountPicture, its initials for now) in the cut frame: near-white on light glass, darkened on smoked. */
export function pictureFrame(username: string, pictureSize: "xs" | "sm" | "md"): Raw {
  return html`<span class="frame ${pictureSize}" aria-hidden="true">${accountPicture(username, pictureSize, { title: "" })}</span>`;
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
    friends.length ? html`<li class="friends"><span class="faces">${friends.map((friend) => pictureFrame(friend.username, "xs"))}</span><span><b>${nameList(friends.map((friend) => friend.username))}</b> ${friends.length > 1 ? "are" : "is"} playing</span></li>` : ""
  }${facts.playedAtMs !== undefined ? html`<li>${icon("clock")}<span>You played ${ago(nowMs - facts.playedAtMs)}</span></li>` : ""}${
    facts.updatedAtMs !== undefined ? html`<li><span class="chip">Updated</span><span>${ago(nowMs - facts.updatedAtMs)}${facts.updatesHref ? html` · <a href="${facts.updatesHref}">What's new</a>` : ""}</span></li>` : ""
  }</ul>`;
}

export const GLANCE_STYLES = `
/* The glance list: one line per fact, each with its own look. People and a clock are line icons; friends are their pictures; an update is a green tag. */
.glance { list-style: none; margin: 0; padding: var(--gap-words-words) 0 0; border-top: 1px solid var(--line); display: grid; gap: var(--gap-words-words); font: 500 15px/1.35 var(--display); color: var(--ink-2); }
.glance li { display: flex; align-items: center; gap: var(--gap-words-words); min-height: 24px; }
.glance b { font-weight: 600; color: var(--ink); }
.glance a { color: var(--ink); font-weight: 600; text-decoration: underline; text-decoration-color: var(--run); text-underline-offset: 3px; text-decoration-thickness: 2px; }
.glance a:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.glance .ico { color: var(--muted); stroke-width: 1.5; }
.chip { display: inline-flex; align-items: center; height: 22px; padding: 0 10px 0 9px; flex: none; font: 600 12px var(--display); color: var(--chip-ink); background: var(--chip-face);
  clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); }
.faces { display: inline-flex; flex: none; }
.faces .frame + .frame { margin-left: -5px; }
`;

component({
  name: "Picture frame",
  slug: "picture-frame",
  group: "data",
  summary: "An account's picture, always in its cut frame: in the account button, beside a friend's name, on a profile.",
  styles: `
/* An account's picture in a cut frame: a ring of the glass's own light (near-white on light glass, darkened on smoked) around the picture. */
.frame { --frame: 38px; --frame-cut: 9px; position: relative; isolation: isolate; display: inline-grid; place-items: center; width: var(--frame); height: var(--frame); flex: none;
  background: var(--face-ring); clip-path: polygon(var(--frame-cut) 0, 100% 0, 100% calc(100% - var(--frame-cut)), calc(100% - var(--frame-cut)) 100%, 0 100%, 0 var(--frame-cut)); }
.frame.sm { --frame: 30px; --frame-cut: 7px; }
.frame.xs { --frame: 22px; --frame-cut: 5px; }
.frame .av { position: absolute; inset: 2px; display: grid; place-items: center; font: 600 calc(var(--frame) * 0.4) var(--display); color: #fff; letter-spacing: 0.01em;
  background: linear-gradient(140deg, hsl(var(--h) 58% 58%), hsl(calc(var(--h) + 45) 48% 52%) 55%, hsl(calc(var(--h) + 90) 48% 55%));
  clip-path: polygon(calc(var(--frame-cut) - 0.8px) 0, 100% 0, 100% calc(100% - var(--frame-cut) + 0.8px), calc(100% - var(--frame-cut) + 0.8px) 100%, 0 100%, 0 calc(var(--frame-cut) - 0.8px)); }
/* The smallest shows only the first letter, as the drafts' friends' pictures do. */
.frame.xs .av { inset: 1.5px; display: block; text-align: center; line-height: calc(var(--frame) - 3px); font-size: 0; }
.frame.xs .av::first-letter { font-size: 11px; }
`,
  render: pictureFrame,
  examples: [
    { label: "Big", markup: pictureFrame("emma_r", "md") },
    { label: "Small", markup: pictureFrame("Liam", "sm") },
    { label: "Smallest, in a row", markup: html`<span class="faces">${["Liam", "Sofia", "Noah", "Mia"].map((name) => pictureFrame(name, "xs"))}</span>` },
  ],
});

const HOUR_MS = 60 * MINUTE_MS;
const glancePane = (body: Raw) => html`<div class="glass example-pane" data-glass data-glass-corners="18 9 18 9">${body}</div>`;

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

