import { html, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import type { ControlMarkup } from "./control-markup.ts";
import { cutButton, tertiaryButton, textLink } from "./actions.ts";
import { ago, glassPane, tag } from "./foundations.ts";
import { pictureFrame } from "./data.ts";
import { row, stack } from "./layout.ts";
import { readingText } from "./reading.ts";

/*
 * People: someone on Zaisma named on a page (a friend in a list, a game's developer, a post's author), and what they wrote (a post). Pages
 * still to build lean on them: Friends, profiles, the forum, a game's page and its updates.
 */

export interface PersonOptions {
  username: string;
  /** Their profile: their name goes there. */
  href: string;
  /** A line about them under their name: "Playing Ashen Crown", "12 games on Zaisma", "Friends since March". */
  note?: string;
  /** Their picture's size: small in a list ("sm"), regular beside a heading or on its own ("md"). */
  pictureSize?: "sm" | "md";
  /** Online, or playing: the picture's presence marks, only where the viewer may see them. */
  presence?: "online" | "playing";
  /** Marks beside their name: Tags (Developer, Blocked). */
  marks?: Raw;
  /** One control at the row's end: Join, Add a friend, or a menu's button. */
  end?: ControlMarkup;
}

/**
 * A person: their picture in its frame, their name a quiet Link to their profile with any marks beside it, a line about them under it, and
 * at most one control at the row's end. A long username wraps rather than being cut.
 */
export function person(options: PersonOptions): Raw {
  const pictureSize = options.pictureSize ?? "md";
  return html`<div class="person ${pictureSize}">${pictureFrame(options.username, pictureSize, { presence: options.presence })}<span class="person-words"><span class="person-name">${textLink(options.username, options.href, { isQuiet: true })}${options.marks ?? ""}</span>${options.note ? html`<span class="person-note">${options.note}</span>` : ""}</span>${options.end ? html`<span class="person-end">${options.end}</span>` : ""}</div>`;
}

export interface PostOptions {
  /** Who wrote it. */
  author: { username: string; href: string };
  /** When it was posted, in milliseconds since 1970: said as "2 h ago". */
  postedAtMs: number;
  /** What it says, as Reading text (readingText), made safe already. */
  body: Raw;
  /** Marks beside the author's name: Tags (Answer, Zaisma, AI). */
  marks?: Raw;
  /** What you can do with it, start to end: Tertiary buttons (Reply, Quote) and toggles with a count (Like). */
  actions?: ControlMarkup[];
}

/**
 * A post: its author (a small Person, with when they posted as its line), what they wrote as Reading text, and what you can do with it in
 * a Row at its foot. A list of posts is Posts, a hairline between each.
 */
export function post(options: PostOptions): Raw {
  return html`<article class="post">${stack({
    items: [
      { kind: "block", markup: person({ username: options.author.username, href: options.author.href, pictureSize: "sm", note: ago(Date.now() - options.postedAtMs), marks: options.marks }) },
      { kind: "words", markup: options.body },
      ...(options.actions?.length ? [{ kind: "block" as const, markup: row({ widths: "fit", items: options.actions.map((action) => ({ kind: "control" as const, markup: action })) }) }] : []),
    ],
  })}</article>`;
}

/** Posts one under another, a hairline between each: a topic's replies, a game's updates. */
export function posts(options: { posts: PostOptions[]; label?: string }): Raw {
  return html`<div class="posts"${options.label ? html` role="feed" aria-label="${options.label}"` : ""}>${options.posts.map((each) => post(each))}</div>`;
}

const HOUR_MS = 60 * 60_000;

component({
  name: "Person",
  slug: "person",
  group: "data",
  subgroup: "pictures",
  summary: "Someone on Zaisma named on a page: a game's developer, a post's author, a friend in a room. Their picture in its frame, their name a quiet link to their profile, a line about them, and at most one thing to do at the end. A list of people is List rows, each led by their picture.",
  styles: `
/* A person: the picture, then the name over a quiet line, a word's gap from it; one control at the end, on the row's center line. A long name
   wraps where it must, never cut. Its name and line are bare words, so a person is a bare group (tokens.ts's BARE_GROUPS): picture, name and
   line move together, the whole row the words margin in from the surface's edge (--pad-words past the frame gap, top and bottom included
   where it meets them), so the picture lines up with the words and the rows' pictures and icons round it, not at the frame gap. */
.person { display: flex; align-items: center; gap: var(--gap-words-control); min-width: 0; }
.person-words { flex: 1 1 auto; display: grid; gap: 0; min-width: 0; }
.person-name { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--gap-words-words); min-width: 0; font: var(--type-name); color: var(--ink); overflow-wrap: anywhere; }
.person.sm .person-name { font: var(--type-label); }
.person-note { font: var(--type-facts); color: var(--muted); }
.person-end { flex: none; display: flex; margin-inline-start: auto; }
`,
  render: person,
  examples: [
    { label: "A game's developer", markup: glassPane({ paneWidth: "fit", body: person({ username: "lumen_works", href: "#person", note: "12 games on Zaisma" }) }) },
    { label: "A friend in a room, with Join", markup: glassPane({ paneWidth: "fit", body: person({ username: "Liam", href: "#person", pictureSize: "sm", presence: "playing", note: "Playing Ashen Crown", end: cutButton("Join", { type: "button", isSmall: true }) }) }) },
    { label: "A long username, with a mark", markup: glassPane({ paneWidth: "fit", body: person({ username: "the_longest_username_allowed", href: "#person", note: "Played 2,140 hours", marks: tag("Developer", "plain") }) }) },
  ],
});

component({
  name: "Post",
  slug: "post",
  group: "data",
  subgroup: "reading",
  summary: "What someone wrote: a forum reply, a game's update. Its author and when, the words as Reading text, and what you can do with it at its foot. A list of posts has a hairline between each.",
  styles: `
/* Posts: one under another, a block's gap and a hairline between each. */
.posts { display: flex; flex-direction: column; gap: var(--gap-block-block); min-width: 0; }
.posts > .post + .post { padding-top: var(--gap-block-block); border-top: var(--divider); }
.post { min-width: 0; }
`,
  render: post,
  examples: [
    {
      label: "A reply, and the answer",
      isWide: true,
      markup: glassPane({
        paneWidth: "full",
        body: posts({
          label: "Replies",
          posts: [
            {
              author: { username: "Sofia", href: "#post" },
              postedAtMs: Date.now() - 2 * HOUR_MS,
              body: readingText({ markup: html`<p>Rooms drop everyone at about 50 players for me too, on Chrome and Firefox. It started after Tuesday's update.</p>` }),
              actions: [tertiaryButton("Reply", { type: "button", icon: "reply" }), tertiaryButton("Quote", { type: "button", icon: "quote" })],
            },
            {
              author: { username: "zaisma_team", href: "#post" },
              postedAtMs: Date.now() - 40 * 60_000,
              marks: tag("Answer", "new"),
              body: readingText({ markup: html`<p>Thanks, both. The fix is live: rooms past 50 players stay connected now. If one still drops, reply here with its room code.</p>` }),
              actions: [tertiaryButton("Reply", { type: "button", icon: "reply" })],
            },
          ],
        }),
      }),
    },
  ],
});
