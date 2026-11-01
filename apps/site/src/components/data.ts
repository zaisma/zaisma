import { EmptyNoteMarkup, NO_EMPTY_NOTE, accountPicture, html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { secondaryButton, primaryButton, textLink, toggleButton } from "./actions.ts";
import { ControlMarkup } from "./control-markup.ts";
import { CUT_LINE, EDGE, MINUTE_MS, ago, glassPane, groove, icon, picture, tag, well, type IconName, type ShownPicture, type TagTone } from "./foundations.ts";
import { STAND_IN_ACCOUNT_PICTURES } from "../generated/stand-in-placeholders.generated.ts";
import { WHEN_EMPTY_STYLES, row, stack, stackOfOne } from "./layout.ts";
import { slab } from "./materials.ts";
import { loadMore, type LoadMoreOptions } from "./load-more.ts";
import { progress } from "./reading.ts";

/*
 * Data: an account's picture in its cut frame, and the glance list, one line per fact, each in its own look.
 * From the header draft (the face in the account button) and the home draft (the pane's glance list).
 */

/** From smallest to largest: a cover's facts (xs), a glance line (sm), a list row or the account button (md), a profile's head (lg). */
export type PictureSize = "xs" | "sm" | "md" | "lg";

/**
 * An account's picture in a small frame of the panes' glass, with its drawn rim: the picture it was given (a Picture, a tiny blurred copy
 * first), or its initials in its own color. Its frame has no corners of its own, so in a pane's corner it takes the corner's cut like
 * anything with an edge, and it's square elsewhere. It shows no status: whether someone's online or playing is said in words beside it
 * (Person's and a list row's activity), where the viewer may see it.
 */
export function pictureFrame(username: string, pictureSize: PictureSize, options: { picture?: ShownPicture } = {}): Raw {
  // The initials are sized to the frame (--frame), so the largest frame takes the account's picture at its largest size.
  const shown = options.picture
    ? picture(options.picture, { shownSizes: `${FRAME_PX[pictureSize]}px`, largestPx: FRAME_PX[pictureSize] * 3 })
    : accountPicture(username, pictureSize === "lg" ? "md" : pictureSize, { title: "" });
  return html`<span class="frame ${pictureSize} glass" data-glass data-glass-corners="0 0 0 0" data-glass-band="2" aria-hidden="true"><span class="frame-picture">${shown}</span></span>`;
}

/** A frame's side at each size, in CSS pixels (.frame's --frame). */
const FRAME_PX: Record<PictureSize, number> = { xs: 24, sm: 32, md: 44, lg: 96 };

/** Someone whose picture is shown in a frame: their name, and the picture they gave (left out, their initials). */
export interface FramedPerson {
  username: string;
  picture?: ShownPicture;
}

/** Friends' pictures in a row, front to back: each lies over the next, casting a small shadow onto it; past three, the rest are a +N at the back. */
export function pictureRow(people: FramedPerson[], pictureSize: PictureSize): Raw {
  const shown = people.slice(0, 3), hiddenCount = people.length - shown.length, placeCount = shown.length + (hiddenCount > 0 ? 1 : 0);
  return html`<span class="picture-row ${pictureSize}">${shown.map(
    (shownPerson, placeIndex) => html`<span class="picture-row-place" style="z-index:${placeCount - placeIndex}">${pictureFrame(shownPerson.username, pictureSize, { picture: shownPerson.picture })}</span>`,
  )}${hiddenCount > 0 ? html`<span class="picture-row-place" style="z-index:1"><span class="frame ${pictureSize} glass more" data-glass data-glass-corners="0 0 0 0" data-glass-band="2" aria-hidden="true">+${hiddenCount}</span></span>` : ""}</span>`;
}

/** Names as a sentence: "Liam", "Liam and Sofia", "Liam, Sofia and Noah"; past three, the three a picture row shows and how many more. */
const nameList = (names: string[]) =>
  names.length === 1 ? names[0]! : names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

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

export interface KeyDetail {
  /** What it is, in a few words, over its value: Playing now, Hosting credit. */
  label: string;
  /** The value, big: a figure already formatted ("1,284", "$12.40"), a few words ("Needs a keyboard"), or pictures (friends'). */
  detailValue: Raw | string;
  /** After a figure, smaller: "hours", "MB". */
  unit?: string;
  /** What goes with the value, under it: whose names, What's new, how a figure moved ("+18% on last week"). */
  under?: Raw | string;
  /** What's under it is good news (more players): it's green. Otherwise it stays quiet. */
  isUnderGood?: boolean;
}

/**
 * Key details: the headline figures of what a page is about, each in a slot of its own, side by side: a small label over its value in a
 * larger type, and what goes with the value under it. A game's own (gameKeyDetails) or a developer's (hosting credit, plays this week).
 * The fuller account goes under them in Details.
 */
export function keyDetails(options: { details: KeyDetail[]; label?: string }): Raw {
  return html`<dl class="key-details words-margin hairline-above"${options.label ? html` aria-label="${options.label}"` : ""}>${options.details.map(
    (detail) =>
      html`<div class="key-detail"><dt>${detail.label}</dt><dd class="key-detail-value">${detail.unit ? html`<span class="key-detail-amount">${detail.detailValue}</span><span class="key-detail-unit">${detail.unit}</span>` : detail.detailValue}</dd>${
        detail.under ? html`<dd class="key-detail-under${detail.isUnderGood ? " good" : ""}">${detail.under}</dd>` : ""
      }</div>`,
  )}</dl>`;
}

/** How long an update stays news, and a game's Key details say it: a week. After that, its Details say when. */
export const UPDATE_IS_NEWS_FOR_MS = 7 * 24 * 60 * MINUTE_MS;

export interface GameKeyDetails {
  playerCount?: number;
  /** When you last played it: an update from before then isn't news to you. Said in Details (Last played), never here. */
  playedAtMs?: number;
  /** When it was last updated: shown here only while it's news (UPDATE_IS_NEWS_FOR_MS, and after you last played); otherwise Details says it. */
  updatedAtMs?: number;
  /** Where its patch notes are, for the Updated line. */
  updatesHref?: string;
  /** Friends playing it now. */
  friends?: FramedPerson[];
  /** Why it may not suit this device ("Needs a keyboard"), for a game made for others. */
  deviceNote?: string;
}

/**
 * A game's Key details: the few things that decide whether you play it now, in one fixed order (this device, playing now, friends, updated
 * while it's news). A detail that isn't true leaves its slot out; the rest keep their order, so the eye finds each in the same place.
 */
export function gameKeyDetails(facts: GameKeyDetails): Raw {
  const nowMs = Date.now();
  const isUpdateNews = facts.updatedAtMs !== undefined && nowMs - facts.updatedAtMs <= UPDATE_IS_NEWS_FOR_MS && (facts.playedAtMs === undefined || facts.updatedAtMs > facts.playedAtMs);
  const friends = facts.friends ?? [];
  const shown: KeyDetail[] = [
    ...(facts.deviceNote ? [{ label: "This device", detailValue: facts.deviceNote }] : []),
    ...(facts.playerCount !== undefined ? [{ label: "Playing now", detailValue: facts.playerCount.toLocaleString("en-US") }] : []),
    ...(friends.length ? [{ label: "Friends playing", detailValue: pictureRow(friends, "sm"), under: html`<span class="one-line">${nameList(friends.map((friend) => friend.username))}</span>` }] : []),
    ...(isUpdateNews && facts.updatedAtMs !== undefined
      ? [{ label: "Updated", detailValue: html`<span class="is-new">${keepUnits(ago(nowMs - facts.updatedAtMs))}</span>`, ...(facts.updatesHref ? { under: textLink("What's new", facts.updatesHref) } : {}) }]
      : []),
  ];
  return keyDetails({ details: shown });
}

export const KEY_DETAILS_STYLES = `
/* Key details: slots side by side, each as wide as what's in it (at least --size-number) and a block apart, never stretched across a wide
   pane, as many to a line as fit (two to a line on a phone), each a small
   label over its value in a larger type, and what goes with the value (whose names, What's new, how it moved) under it. A figure never
   breaks: a long one (the millions) takes a wider slot and the rest go on to the next line. A unit sits smaller beside its figure. Under
   something else in its pane (a game's title), a hairline parts them. */
.key-details { margin: 0; display: flex; flex-wrap: wrap; gap: var(--gap-words-control) var(--gap-block-block); }
.key-detail { flex: none; min-width: var(--size-number); max-width: 100%; display: grid; align-content: start; gap: 2px; }
.key-detail > dt { font: var(--type-facts); color: var(--ink-2); }
.key-detail > dd { margin: 0; min-width: 0; }
/* A game's pane title grows with its key details, in a game's title's type. */
.glass-pane:has(.key-details) :is(h1, h2) { font: var(--type-title); }
/* A pane holding Key details sets its title a size up, in a title's size, so it stays over figures set in a heading's. */
/* The value in a heading's size, well over its label and what's under it, so a strip reads as figures, not a paragraph. */
.key-detail-value { font: var(--type-heading); color: var(--ink); font-variant-numeric: tabular-nums; }
.key-detail-value:has(> .key-detail-unit) { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: var(--gap-words-words); }
.key-detail-amount { white-space: nowrap; }
.key-detail-unit { font: var(--type-label); color: var(--ink-2); }
.key-detail-value > .is-new { color: var(--tag-new-ink); }
.key-detail-value > .picture-row { margin-block: 2px; }
.key-detail-under { font: var(--type-facts); color: var(--ink-2); }
.key-detail-under.good { color: var(--tag-new-ink); }
/* Names on one line that end in an ellipsis rather than run past the pane. */
.key-detail-under:has(> .one-line) { display: flex; }
/* Before a row's buttons, the row's own gap parts them; the words margin is only for the pane's edge. */
.row-cell:not(:last-child) > .key-details { padding-inline-end: 0; }
`;

/** The gallery's stand-in for a picture someone gave (brand/design/pictures). */
const FRAME_SAMPLE_PICTURE = STAND_IN_ACCOUNT_PICTURES["kestrel-sky"]!;

component({
  name: "Picture frame",
  slug: "picture-frame",
  group: "data",
  subgroup: "pictures",
  summary: "An account's picture, always in its frame of glass: in the account button, beside a friend's name, at the head of a profile. The picture they gave, or their initials in their own color. It shows no status: online or playing is said in words beside it.",
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
/* The picture takes its frame's shape: in a pane's corner, the corner's cut, as the frame's glass does. */
.frame.glass > .frame-picture { position: absolute; z-index: 2; inset: 0; clip-path: var(--glass-clip, none); }
/* A quiet rim: half the panes' strength, so it reads as glass without framing the face. */
.frame.glass > .edge { z-index: 4; opacity: 0.5; }
/* An account's picture fills its frame, or the slab that holds it as art (your picture as the account button). */
:is(.frame, .slab.holds-art) .av { position: absolute; inset: 0; width: 100%; height: 100%; display: grid; place-items: center; font: 600 calc(var(--frame, var(--control-height)) * 0.38) var(--display); color: #fff; letter-spacing: 0.01em;
  background: linear-gradient(140deg, hsl(var(--h) 58% 58%), hsl(calc(var(--h) + 45) 48% 52%) 55%, hsl(calc(var(--h) + 90) 48% 55%)); }
/* A picture it was given fills the frame, cropped to its square. */
.frame-picture > .picture { position: absolute; inset: 0; }
.frame-picture > .picture > img { width: 100%; height: 100%; object-fit: cover; }
/* The smallest shows only the first letter. */
.frame.xs .av { display: block; text-align: center; line-height: var(--frame); font-size: 0; }
.frame.xs .av::first-letter { font-size: 11px; }
`,
  render: pictureFrame,
  examples: [
    { label: "Big", markup: pictureFrame("emma_r", "md") },
    { label: "Big, with a picture they gave", markup: pictureFrame("emma_r", "md", { picture: FRAME_SAMPLE_PICTURE }) },
    { label: "Small: initials, a picture", markup: html`${pictureFrame("Liam", "sm")}${pictureFrame("Sofia", "sm", { picture: FRAME_SAMPLE_PICTURE })}` },
    { label: "Smallest: initials, a picture", markup: html`${pictureFrame("Mia", "xs")}${pictureFrame("Noah", "xs", { picture: FRAME_SAMPLE_PICTURE })}` },
    { label: "A profile's head: initials, a picture", markup: html`${pictureFrame("Sofia", "lg")}${pictureFrame("Lucas", "lg", { picture: FRAME_SAMPLE_PICTURE })}` },
  ],
});

/** The gallery's people with no picture of their own: their initials. */
const namesOnly = (usernames: string[]): FramedPerson[] => usernames.map((username) => ({ username }));

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
/* A picture is the same wherever it sits: behind another, its initials (or the +N) stay whole in its middle, and the one in front covers
   only its edge, an eighth of it, clear of the initials. */
.picture-row.lg { --frame-overlap: 12px; }
.picture-row.md { --frame-overlap: 5px; }
.picture-row.sm { --frame-overlap: 4px; }
.picture-row.xs { --frame-overlap: 3px; }
/* The +N is sized to its frame, like the initials in a picture. */
.frame.more { font: 600 calc(var(--frame) * 0.36)/1 var(--display); font-variant-numeric: tabular-nums; }
`,
  render: pictureRow,
  examples: [
    { label: "Three friends, front to back", markup: pictureRow(namesOnly(["Liam", "Sofia", "Noah"]), "sm") },
    { label: "With a picture someone gave, among initials", markup: pictureRow([{ username: "Liam" }, { username: "Sofia", picture: FRAME_SAMPLE_PICTURE }, { username: "Noah" }], "sm") },
    { label: "Seven: three, then +4", markup: pictureRow(namesOnly(["Liam", "Sofia", "Noah", "Mia", "Lucas", "Emma", "Oliver"]), "sm") },
    { label: "Big, in a row, with a picture", markup: pictureRow([{ username: "Liam", picture: FRAME_SAMPLE_PICTURE }, { username: "Sofia" }, { username: "Noah" }, { username: "Mia" }], "md") },
    { label: "Smallest, in a row (a cover's facts)", markup: pictureRow(namesOnly(["Liam", "Sofia", "Noah", "Mia", "Lucas"]), "xs") },
  ],
});

/** What a version is now, as every list and table of versions says it: from its scan_status, is_live, scheduled_publish_at and replaced_by_version_id. */
export type VersionState = "scanning" | "held" | "rejected" | "passed" | "scheduled" | "live" | "replaced";

/** A version's state as its Tag, the same wherever versions are listed: live is green, held and rejected red with their mark, the rest plain words. */
export const VERSION_STATE_TAGS: Record<VersionState, Raw> = {
  live: tag("Live", "new"),
  passed: tag("Passed", "count"),
  scheduled: tag("Scheduled", "count"),
  scanning: tag("Scanning", "count"),
  held: tag("Held", "problem"),
  rejected: tag("Rejected", "problem"),
  replaced: tag("Replaced", "plain"),
};

/** A filter in use, said as a tag that removes it: its link is the list without it. */
export interface TagInUse {
  label: string;
  removeHref: string;
}

/** The filters in use, under a list's Filter button: a tag each, with a close mark, that takes that one away. They wrap onto more lines. */
export function tagsInUse(options: { tags: TagInUse[] }): Raw {
  return html`<div class="tags-in-use" role="group" aria-label="Filters in use: each removes itself">${options.tags.map((inUse) => tag(inUse.label, "plain", { removeHref: inUse.removeHref }))}</div>`;
}

component({
  name: "Tag",
  slug: "tag",
  group: "data",
  subgroup: "lists",
  summary: "A few words or a number carved into what they label, square, its corners cut only where it sits in a pane's corner: Updated on a game, the count of unread topics on a place, a version's state. Amber for what needs a look (reports), red for a problem (a hold, a takedown), which always leads with its mark. On glass, a mark's name on the rail. Removable, a filter in use under a list's Filter button, which a press takes away.",
  styles: `
/* A tag is the carving's smallest form (materials.ts): new, a count, plain or a warning, or glass. */
/* An icon before its words, small and in their color, says what kind of tag it is at a glance. */
.tag:has(> .ico) { gap: 4px; }
.tag > .ico { width: 12px; height: 12px; stroke-width: 2; }
.tag.glass { color: var(--ink); --glass-tint: var(--glass-dropdown); }
/* A glass tag is cut as a pane is: its glass layer takes the cut, not the tag. A tag that clipped itself would be all its glass could see
   through (a clip makes a backdrop of its own), so nothing behind it would blur. */
.tag.glass:not([data-glass]) { clip-path: none; --glass-clip: var(--cut-shape, none); }
.tag.glass.is-new { color: var(--tag-new-ink); }
/* Removable: a link, its words then a close mark, a little taller so it's easy to press; pointed at, its words and mark light up. */
/* A removable tag is a link round the tag, so its reach for a finger isn't cut away with the tag's own corners. */
.tag-remove { display: inline-flex; text-decoration: none; -webkit-tap-highlight-color: transparent; }
.tag.is-removable { height: 26px; gap: 4px; padding-inline: 9px 8px; }
.tag.is-removable > .ico { width: 12px; height: 12px; stroke-width: 2; }
.tag-remove:hover > .tag.is-removable { color: var(--ink); }
.tag-remove:focus-visible { outline: none; }
.tag-remove:focus-visible > .tag.is-removable { box-shadow: var(--tag-carve), inset 0 0 0 2px var(--focus); }
/* On a touch screen its remove press reaches past its own box to a touch target's height, unseen, as a small button's does. */
@media (pointer: coarse) { .tag-remove { position: relative; } .tag-remove::after { content: ""; position: absolute; left: 0; right: 0; top: min(0px, calc((100% - var(--touch-target)) / 2)); bottom: min(0px, calc((100% - var(--touch-target)) / 2)); } }
.tags-in-use { display: flex; flex-wrap: wrap; gap: var(--gap-words-words); }
`,
  render: (words: string | number, tone: TagTone, options?: { icon?: IconName }) => tag(words, tone, options),
  examples: [
    { label: "New", markup: tag("Updated", "new") },
    { label: "A count", markup: tag(3, "count") },
    { label: "Plain words", markup: tag("Replaced", "plain") },
    { label: "With an icon", markup: html`${tag("Reports", "warning", { icon: "flag" })} ${tag("Developer", "plain", { icon: "code" })}` },
    { label: "A warning: what needs a look", markup: tag("3 reports", "warning") },
    { label: "A problem: a hold or a takedown, always with its mark", markup: tag("Held", "problem") },
    { label: "On glass", markup: tag("Continue playing", "glass") },
    { label: "New, on glass: over a game card's art", markup: tag("Updated", "new-on-glass") },
    { label: "A version's state, the same everywhere", isWide: true, markup: html`${Object.values(VERSION_STATE_TAGS)}` },
    { label: "Removable: the filters in use on a list", markup: tagsInUse({ tags: [{ label: "Adventure", removeHref: "#tag" }, { label: "$15 to $30", removeHref: "#tag" }] }) },
    { label: "Removable, many, wrapping", markup: html`<div style="width:min(220px,100%)">${tagsInUse({ tags: [{ label: "Role-playing", removeHref: "#tag" }, { label: "Multiplayer", removeHref: "#tag" }, { label: "$30 and up", removeHref: "#tag" }] })}</div>` },
  ],
});

const HOUR_MS = 60 * MINUTE_MS;
const keyDetailsPane = (body: Raw) => glassPane({ paneWidth: "fit", body: stackOfOne(body, "words") });
const keyDetailsWidePane = (body: Raw) => glassPane({ paneWidth: "full", body: stackOfOne(body, "words") });

component({
  name: "Key details",
  slug: "key-details",
  group: "data",
  subgroup: "lists",
  summary: "The headline figures of what a page is about, side by side: a small label over each value in big words, and what goes with it under it (whose names, how a figure moved, green when good). A game's above Play: this device, playing now, friends playing, and an update while it's news (in the last week, since you last played). A developer's: credit, plays, hours. The fuller account goes under them in Details.",
  styles: KEY_DETAILS_STYLES,
  render: keyDetails,
  examples: [
    { label: "On a game's pane: under its name, before Play and its Details", isWide: true, markup: gamePaneExample() },
    {
      label: "On a busy game's pane: millions playing, many friends, updated six days ago",
      isWide: true,
      markup: gamePaneExample({
        playerCount: 2_481_309,
        friends: ["Liam", "Sofia", "Noah", "Emma", "Oliver", "Mia", "Lucas", "Charlotte", "Benjamin", "Amelia", "Henry", "Isabella"].map((username) => ({ username })),
        playedAtMs: Date.now() - 12 * 24 * HOUR_MS,
        updatedAtMs: Date.now() - 6 * 24 * HOUR_MS,
        updatesHref: "#key-details",
      }),
    },
    { label: "Players now", markup: keyDetailsPane(gameKeyDetails({ playerCount: 1204 })) },
    { label: "Friends playing", markup: keyDetailsPane(gameKeyDetails({ friends: [{ username: "Liam" }, { username: "Sofia" }] })) },
    { label: "Updated, while it's news: in the last week, since you last played", markup: keyDetailsPane(gameKeyDetails({ updatedAtMs: Date.now() - 26 * HOUR_MS, updatesHref: "#key-details" })) },
    {
      label: "A developer's week: figures with their units, and how each moved, green when it's good news",
      isWide: true,
      markup: keyDetailsWidePane(keyDetails({ label: "This week", details: [
        { label: "Players", detailValue: "1,284", under: "+18% on last week", isUnderGood: true },
        { label: "Hours played", detailValue: "3,906", unit: "hours", under: "+6% on last week", isUnderGood: true },
        { label: "Plays", detailValue: "9,412", under: "−3% on last week" },
        { label: "Stored", detailValue: "48.1", unit: "MB" },
      ] })),
    },
    {
      label: "In the millions: a long figure takes a wider slot, never breaking",
      isWide: true,
      markup: keyDetailsWidePane(keyDetails({ label: "All time", details: [
        { label: "Players all time", detailValue: "12,480,915", under: "+4% on last month", isUnderGood: true },
        { label: "Hours played", detailValue: "1,906,442", unit: "hours", under: "+9% on last month", isUnderGood: true },
        { label: "Plays", detailValue: "38,204,117" },
        { label: "Stored", detailValue: "4.8", unit: "GB" },
      ] })),
    },
    {
      label: "All three, in their order: an older update and when you last played go in Details",
      isWide: true,
      markup: keyDetailsWidePane(gameKeyDetails({ playerCount: 1204, friends: [{ username: "Liam" }, { username: "Sofia" }, { username: "Noah" }], playedAtMs: Date.now() - 3 * 24 * HOUR_MS, updatedAtMs: Date.now() - 26 * HOUR_MS, updatesHref: "#key-details" })),
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
  /** What someone is doing now, in green under the title, before any detail: "Online", "Playing Ashen Crown". Only where the viewer may see it. */
  activity?: string;
  /** What leads the row, before its title: a Picture frame (a player, a friend) or an icon (a key, a passkey). */
  lead?: Raw;
  /** An icon leading it in a tag's tone: red for a problem (a hold), amber for what needs a look (reports), as a game's What needs you lists them. */
  leadTone?: "problem" | "warning";
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
  /** Unique on the page, on the row itself (its link or button), for a page's script to find it: a player's Block. */
  id?: string;
}

/** A row that does something, pressed as a whole: a button (a player's Block, Show QR code), its words and nothing at its end. */
export interface RowPress {
  /** The sheet or light box it opens (its id). */
  controls?: string;
  /** data-* attributes a page's script reads ({ "sheet-step-to": "report" }), names in lowercase words joined by dashes. */
  dataAttributes?: Record<string, string>;
}

/** A row's switch (Toggle, in Inputs): on or off for a setting that takes effect as it's saved. The whole row is its label, so a press anywhere on it flips it. */
export interface RowSwitch {
  name: string;
  isOn: boolean;
  /** Unique on the page. Defaults to switch-<name>. */
  id?: string;
  /** Its change is being saved: it waits (the materials' waiting state), and it can't be flipped again until it's saved. A page script sets it. */
  isBusy?: boolean;
  /** It can't be changed now: it shows on or off, and its form sends nothing for it. */
  isDisabled?: boolean;
}

/** A row that opens: what's folded under it, shown in a well under the row once it's pressed. */
export type RowFold = {
  /** Unique on the page: the row's anchor, so a link to #<id> lands on it open (LIST_ROW_FOLD_SCRIPT). */
  id?: string;
  isOpen?: boolean;
} & (
  /** What opens under it: a rule's Fine and Not fine, a table of credit entries. */
  | { body: Raw; rows?: never }
  /** More rows of the same list, folded under it (Earlier's older history): they continue the list, indented, in its own well, as a
   *  switch's rows while it's on do. */
  | { rows: ListRow[]; body?: never }
);

/**
 * A row that goes somewhere is a link as a whole, so it never holds a button; a row that does something (press) is a button as a whole, a
 * short list of them a sheet's things to do (a player's Profile, Block and Report); a row to read may end in any control (Remove, Invite, a
 * select), or in a few small ones side by side (a player in a room: Mute, and ⋯ for the rest); a row for a setting ends in a switch, and
 * is pressed as a whole. A switch row may hold the rows that only matter while it's on, in a well under it. A row that opens (fold) is
 * pressed as a whole too and starts with a chevron that turns down as it opens, what's folded under it indented under it: something that
 * belongs on the page but out of the way (earlier entries, blocked people), or things to scan by a title and a line (the content rules).
 */
export type ListRow = ListRowParts & (
  | { href: string; action?: never; switch?: never; rowsWhileOn?: never; fold?: never; press?: never }
  | { href?: undefined; action?: ControlMarkup | ControlMarkup[]; switch?: never; rowsWhileOn?: never; fold?: never; press?: never }
  | { href?: undefined; action?: never; switch: RowSwitch; rowsWhileOn?: ListRow[]; fold?: never; press?: never }
  | { href?: undefined; action?: never; switch?: never; rowsWhileOn?: never; fold: RowFold; press?: never }
  | { href?: undefined; action?: never; switch?: never; rowsWhileOn?: never; fold?: never; press: RowPress }
);

/** A switch's carved slot and its slab: the checkbox (role switch) lies over the slot, unseen, and the row round it is its label. */
function switchSlot(id: string, rowSwitch: RowSwitch): Raw {
  return html`<span class="toggle-slot carving slot" data-cut-line="8">${CUT_LINE}<input class="toggle-input" type="checkbox" role="switch" id="${id}" name="${rowSwitch.name}" value="on"${rowSwitch.isOn ? raw(" checked") : ""}${rowSwitch.isBusy ? raw(' aria-busy="true"') : ""}${rowSwitch.isBusy || rowSwitch.isDisabled ? raw(" disabled") : ""}><span class="toggle-thumb thumb" aria-hidden="true"><span class="thumb-slab cut-raised" data-cut-line="6" data-cut-ends="start end">${CUT_LINE}</span></span></span>`;
}

/** A row's buttons side by side, slanting toward each other. */
const rowOf = (actions: ControlMarkup[]) => row({ widths: "fit", items: actions.map((markup) => ({ kind: "control" as const, markup })) });

/**
 * List rows: a list on glass, one thing a row with hairlines between (versions, keys, topics, players); a row with an address is a link as a whole.
 * whenEmpty (an Empty state) shows in its place while it has no rows shown, a page script's rows included (WHEN_EMPTY_STYLES).
 */
export function listRows(options: { rows: ListRow[]; whenEmpty: EmptyNoteMarkup; id?: string; label?: string; shownRowCount?: number; isCompact?: boolean }): Raw {
  const cap = options.shownRowCount ? html` style="--shown-row-count:${String(options.shownRowCount)}"` : "";
  // The list is carved into whatever holds it, a well with edges of its own wherever it sits; one that holds rows you press lights its
  // edge beside the one you point at (Edge light).
  const isPressed = options.rows.some((row) => row.href || row.press || row.fold);
  return html`${well({ kind: "list-well", body: listMarkup(options, cap), edgeLight: isPressed ? "left" : undefined })}${whenEmptyMarkup(options.whenEmpty, options.rows.some((row) => !row.isHidden))}`;
}

/**
 * What shows in a list's place while it has nothing in it: right after the list, which hides itself while it's empty (WHEN_EMPTY_STYLES).
 * Hidden while the list has things, so the layout's edge rules see the list as what ends its pane.
 */
const whenEmptyMarkup = (whenEmpty: EmptyNoteMarkup, isListShown: boolean): Raw => html`<div class="when-empty"${isListShown ? raw(" hidden") : ""}>${whenEmpty}</div>`;

function listMarkup(options: { rows: ListRow[]; id?: string; label?: string; shownRowCount?: number; isCompact?: boolean }, cap: Raw | ""): Raw {
  return html`<ul class="list-rows hairlines${options.shownRowCount ? " is-capped scrolls own-scroll" : ""}${options.isCompact ? " is-compact" : ""}"${cap}${options.id ? html` id="${options.id}"` : ""}${options.label ? html` aria-label="${options.label}"` : ""}>${options.rows.map((row) => {
    const details = [row.detail, row.secondDetail].filter((line): line is string => Boolean(line));
    const inside = html`${row.lead ? html`<span class="list-row-lead${row.leadTone ? ` is-${row.leadTone}` : ""}">${row.lead}</span>` : ""}<span class="list-row-words">${row.titleIcon ? html`<span class="list-row-title-line"><span class="list-row-title">${row.title}</span><span class="list-row-title-icon" role="img" aria-label="${row.titleIcon.label}" title="${row.titleIcon.label}"${row.titleIcon.isHidden ? raw(" hidden") : ""}>${icon(row.titleIcon.icon)}</span></span>` : html`<span class="list-row-title">${row.title}</span>`}${row.activity ? html`<span class="list-row-activity">${row.activity}</span>` : ""}${details.map((line) => html`<span class="list-row-detail">${factLine(line, "list-row-fact")}</span>`)}${row.meter ? html`<span class="list-row-meter">${usageMeter({ ...row.meter, isTrackOnly: true })}</span>` : ""}</span>${row.end !== undefined ? html`<span class="list-row-end">${row.end}</span>` : ""}`;
    return html`<li${row.isHidden ? raw(" hidden") : ""}>${row.href
      ? html`<a class="list-row flush-row is-link${row.state ? ` ${row.state}` : ""}" data-lights${row.id ? html` id="${row.id}"` : ""} href="${row.href}"${row.isNewTab ? raw(' target="_blank" rel="noopener noreferrer"') : ""} data-cut-line="8">${CUT_LINE}${inside}<span class="list-row-go${row.isNewTab ? " is-new-tab" : ""}" aria-hidden="true">${icon(row.isNewTab ? "out-of-page" : "chevron-right")}</span></a>`
      : row.press
        ? html`<button type="button" class="list-row flush-row is-press${row.state ? ` ${row.state}` : ""}" data-lights${row.id ? html` id="${row.id}"` : ""}${row.press.controls ? html` aria-controls="${row.press.controls}"` : ""}${Object.entries(row.press.dataAttributes ?? {}).map(([name, text]) => html` data-${name}="${text}"`)} data-cut-line="8">${CUT_LINE}${inside}</button>`
      : row.switch
        ? switchRowMarkup(row, row.switch, inside)
        : row.fold
        ? foldRowMarkup(row, row.fold, inside)
        : html`<div class="list-row flush-row quiet">${inside}${row.action ? html`<span class="list-row-action">${Array.isArray(row.action) ? rowOf(row.action) : row.action}</span>` : ""}</div>`}</li>`;
  })}</ul>`;
}

/** A switch row: a label as a whole, its words then its switch, and under it, while it's on, the rows that only matter then, in a well. */
function switchRowMarkup(row: ListRow, rowSwitch: RowSwitch, inside: Raw): Raw {
  const id = rowSwitch.id ?? `switch-${rowSwitch.name}`;
  const className = ["list-row", "flush-row", "toggle", row.state ?? "", rowSwitch.isDisabled ? "is-disabled quiet" : ""].filter(Boolean).join(" ");
  const whileOn = row.rowsWhileOn?.length
    ? html`<div class="list-row-while-on">${listMarkup({ rows: row.rowsWhileOn, isCompact: true }, "")}</div>`
    : "";
  return html`<label class="${className}" for="${id}" data-cut-line="8">${CUT_LINE}${inside}<span class="list-row-action">${switchSlot(id, rowSwitch)}</span></label>${whileOn}`;
}

/** A row that opens: a summary pressed as a whole, a chevron at its start that turns down as it opens, then its words; what's folded under it is indented under them. */
function foldRowMarkup(row: ListRow, fold: RowFold, inside: Raw): Raw {
  return html`<details class="list-row-fold"${fold.id ? html` id="${fold.id}"` : ""}${fold.isOpen ? raw(" open") : ""}><summary class="list-row flush-row is-fold${row.state ? ` ${row.state}` : ""}" data-lights data-cut-line="8">${CUT_LINE}<span class="list-row-go" aria-hidden="true">${icon("chevron-right")}</span>${inside}</summary><div class="list-row-fold-body">${fold.rows ? listMarkup({ rows: fold.rows, isCompact: true }, "") : fold.body}</div></details>`;
}

/**
 * A row whose buttons have icons: measured with their words shown, it's narrow (is-narrow) when that leaves its own words less than a card's
 * third (ROW_WORDS_LEAST_PX), and its buttons then show their icons alone. Measured again whenever it changes size.
 */
export const LIST_ROW_FIT_SCRIPT = `/* list row fit */(function () {
  var ROW_WORDS_LEAST_PX = 120;
  function fit(row) {
    var words = row.querySelector(":scope > .list-row-words"); if (!words) return;
    row.classList.remove("is-narrow");
    if (words.getBoundingClientRect().width < ROW_WORDS_LEAST_PX) row.classList.add("is-narrow");
  }
  var watcher = typeof ResizeObserver === "function" ? new ResizeObserver(function (entries) { entries.forEach(function (entry) { fit(entry.target); }); }) : null;
  window.zaismaWatch.each(".list-row:has(> .list-row-action .cut-btn > .face > .ico)", function (row) { fit(row); if (watcher) watcher.observe(row); });
})();
`;

/** Opens the folding row a link points at (#<id>), on arrival and when the address's anchor changes. */
export const LIST_ROW_FOLD_SCRIPT = `
(() => {
  const openTarget = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const foldRow = id ? document.getElementById(id) : null;
    if (foldRow && foldRow.matches("details.list-row-fold")) foldRow.open = true;
  };
  openTarget();
  addEventListener("hashchange", openTarget);
  // Closing, what's folded slides shut while the row is still open, and only then does it close: Safari hides it the moment it closes, so
  // it would snap shut. Pressed again while it slides, it opens back.
  document.addEventListener("click", (event) => {
    const summary = event.target instanceof Element ? event.target.closest("details.list-row-fold > summary") : null;
    const fold = summary ? summary.parentElement : null;
    if (!fold || !fold.open) return;
    event.preventDefault();
    if (fold.classList.contains("is-closing")) { fold.classList.remove("is-closing"); clearTimeout(fold.closeLater); return; }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { fold.open = false; return; }
    fold.classList.add("is-closing");
    const close = () => { if (!fold.classList.contains("is-closing")) return; fold.classList.remove("is-closing"); fold.open = false; };
    const seconds = parseFloat(getComputedStyle(fold, "::details-content").transitionDuration) || 0.4;
    fold.closeLater = setTimeout(close, seconds * 1000 + 20);
  });
})();
`;

const VERSION_LIST_ROWS: ListRow[] = [
  { title: "Version 15", detail: "An hour ago · 314 files · 49.2 MB", href: "#list-rows", end: VERSION_STATE_TAGS.held },
  { title: "Version 14", detail: "2 days ago · 312 files · 48.1 MB", href: "#list-rows", end: VERSION_STATE_TAGS.live },
  { title: "Version 13", detail: "5 days ago · 309 files · 47.6 MB", href: "#list-rows", end: VERSION_STATE_TAGS.replaced },
];
const listPane = (rows: ListRow[]) => glassPane({ paneWidth: "fit", body: stackOfOne(listRows({ rows, whenEmpty: stateNote({ stateKind: "empty", title: "No versions yet", text: "Each upload you check shows here." }) })) });
const ROW_BUTTON = { type: "button", isSmall: true } as const;
/** A list across a page's column, as the pages coming use them. */
const fullListPane = (rows: ListRow[]) => glassPane({ paneWidth: "full", body: stackOfOne(listRows({ rows, whenEmpty: NO_EMPTY_NOTE })) });

component({
  name: "List rows",
  slug: "list-rows",
  group: "data",
  subgroup: "lists",
  summary: "A list of things carved into a well of its own wherever it sits, one a row with hairlines between: versions, keys, topics, players, settings. A row that goes somewhere is a link as a whole, ending in a chevron that steps on as you point; a row that does something (Block, Show QR code) is a button as a whole; a row to read may end in any control, a button or a select; a row for a setting ends in its switch (Toggle) and is pressed as a whole, holding the settings it turns on indented under it. Words and the control at a row's end keep one margin, so a row reads as one thing. A row may open instead, pressed as a whole, its chevron at its start turning down and what's folded under it indented under it: something out of the way (blocked people, earlier entries) or things to scan by a title and a line (the content rules).",
  styles: `
/* List rows: one thing a row, hairlines between. A row that's a link ends in a small chevron; under the pointer the row brightens a little
   (a faint slab, cut by the edge rule), an orange mark rises at its start, and the chevron steps on, the way the guest button's arrow does.
   A row may lead with a picture or an icon, take a second line of details, and, when it isn't a link, end in a button. */
.list-rows { list-style: none; margin: 0; padding: 0; display: grid; }
/* A row runs the list's whole width: the reading measure that keeps a pane's sentences short (75ch on its li) isn't for rows. */
.list-rows > li { max-width: none; }
/* The list's well: carved into what holds it, the rows right to its edges (each row keeps its own inset), hairlines between them. */
.list-well > .well-body { padding: 0; }
/* What's in its rows (a picture, a button) keeps the rows' own inset from the well's edges, so the edge rule's line in a corner is moved in
   by that much (--rail-inset): a picture or button in a corner row is cut along the well's corner, as anything at a pane's frame gap is. */
.list-well { --rail-inset: var(--pad-frame); }
/* A picture or button at a row's start or end keeps the same gap from the well's side as from its top and foot (the frame gap), so it
   reads as set into the well, not pressed against its sides; a row's words keep the words margin where nothing leads them. */
.list-well .list-row { --row-block: var(--pad-frame); }
.list-well .list-row:has(> .list-row-lead) { --row-start: var(--pad-frame); }
/* An icon (any drawn mark, a line icon or a filled one like Play) is a mark, not a piece with edges: a row it leads keeps the words inset from the well's side, and the icon a wider gap from its words,
   each in the same 20px place, so the words of every icon-led row start at one line. */
.list-well .list-row:has(> .list-row-lead > svg) { --row-start: var(--pad-inside-words); }
.list-row-lead:has(> svg) { width: 20px; justify-content: center; margin-inline-end: var(--gap-words-control); }
.list-well .list-row:has(> .list-row-action) { --row-end: var(--pad-frame); }
/* A row you press (a link, a press, a fold) carries data-lights: pointing at it is only light, the well's edge lit beside it and its
   chevron stepping on, with no wash of its own; pressed (a link or a press), it's carved a step into the well in place: a carving's rim of its own, cut at its corners, shaded along
   its top and lit along its foot, its glass no darker. */
.list-well .list-row:is(.is-link, .is-press, .is-fold):is(:hover, .is-pointed, :focus-visible, .is-focused) { --face-color: transparent; }
.list-well .list-row:is(.is-link, .is-press):is(:active, .is-pressed) { --face-color: transparent; box-shadow: var(--carving-shade); }
.list-well .list-row:is(.is-link, .is-press):is(:active, .is-pressed) > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
.list-well .list-row:is(.is-link, .is-press):is(:active, .is-pressed) > .cut-line polygon { stroke: var(--carve-rim); stroke-width: 2; }
/* A row that opens never carves (glass never changes its size, and what it opens would have to): pressed, only its words sink a pixel in
   place, the edge stays lit, and what slides open or shut under it is the press's answer. */
.list-well .list-row.is-fold:is(:active, .is-pressed) { --face-color: transparent; box-shadow: none; }
/* Opening and closing, what's folded under a row slides open and shut: a grid row growing from nothing to its content's height, which every
   browser animates (Safari can't animate a height to auto). */
.list-row-fold::details-content { display: grid; grid-template-rows: 0fr; overflow: clip; transition: grid-template-rows var(--motion-glide) var(--ease-glide), content-visibility var(--motion-glide) allow-discrete; }
.list-row-fold[open]::details-content { grid-template-rows: 1fr; }
.list-row-fold[open].is-closing::details-content { grid-template-rows: 0fr; }
.list-row-fold-body { min-height: 0; overflow: clip; }
/* Its gap under what it holds is a part of what it holds, never padding, which would keep the closed row open by that much. */
.list-rows .list-row-fold-body { padding-bottom: 0; }
.list-row-fold-body::after { content: ""; display: block; height: var(--gap-words-control); }
@media (prefers-reduced-motion: reduce) { .list-row-fold::details-content { transition: none; } }
/* What an open row or a switch turned on holds lies under it, indented to where the row's words start past its opener, with no hairline
   between: it reads as the row's own, as a file tree's children do. */
.list-rows { --fold-indent: calc(var(--pad-words) + 8px + var(--gap-words-control)); }
.list-row-while-on, .list-row-fold-body { padding: 0 0 var(--gap-words-control) var(--fold-indent); }
/* Capped: about shownRowCount rows in view, half of the next showing so it's clear the list scrolls inside itself, the page staying short. It holds a swipe or a wheel only while it has something to scroll (is-scrollable, tokens.ts): a short list passes it on to the page. */
.list-rows.is-capped { --list-row-height: 65px; max-height: calc((var(--shown-row-count) + 0.5) * var(--list-row-height)); }
/* With its rail showing (the rail lies along its right edge), the rows keep clear of it, so a row's button never sits against the rail. */
/* Every row has one shape, never stacked: what leads it, its words, and what ends it, on one line; when room runs out the words give way
   (wrapping in their own column), never the lead or the end. */
.list-row { position: relative; display: flex; flex-wrap: nowrap; align-items: center; gap: var(--gap-words-control); --row-height: 60px; --row-block: 10px; --row-start: var(--pad-inside-words); --row-end: var(--pad-inside-words); color: var(--ink); text-decoration: none; }
/* With nothing leading it, a row's words line up with the pane's words: its start is the pane's words inset. */
.list-row:not(:has(> .list-row-lead)) { --row-start: var(--pad-words); }
/* A row pressed as a whole (a link, a fold, a button) keeps what leads it and its chevron on its line, its words wrapping between them
   however narrow the pane: only a row's own buttons go under its words. */
.list-row.quiet { cursor: auto; }
.list-row > :not(.cut-line) { position: relative; z-index: 2; }
.list-row-lead { flex: none; display: inline-flex; color: var(--ink-2); }
/* Compact: a long list in a narrow place (the players in a room): one line a row, its words taking what's left beside its picture and buttons. */
.list-rows.is-compact > li > .list-row { flex-wrap: nowrap; --row-height: 44px; --row-block: calc(var(--gap-control-stack) * 0.75); }
.list-rows.is-compact .list-row-words { flex: 1 1 0; }
.list-row-lead > .ico { width: 20px; height: 20px; }
.list-row-lead.is-problem { color: var(--tag-problem-ink); }
.list-row-lead.is-warning { color: var(--tag-warning-ink); }
/* The words keep a card's width at least: where the buttons don't fit beside that, they go under the words, at the row's end. */
.list-row-words { display: grid; gap: var(--gap-words-words); min-width: 0; flex: 1 1 0; }
/* Its words keep a block's gap from the buttons or facts at its end, so the row never reads as cramped, even where it's only as wide as
   what's in it. */
.list-row:has(> .list-row-action, > .list-row-end) > .list-row-words { margin-inline-end: calc(var(--gap-block-block) - var(--gap-words-control)); }
/* A long title wraps rather than being cut short, a web address anywhere. */
.list-row-title { font: var(--type-label); color: var(--ink); overflow-wrap: anywhere; }
.list-row-detail { font: var(--type-facts); color: var(--muted); }
/* What someone is doing now: green words, so the color only backs up what they say. */
.list-row-activity { font: var(--type-facts); color: var(--tag-new-ink); }
/* An icon after the title (a friend's mark), in the second words' color, on the title's line. */
.list-row-title-line { display: flex; align-items: center; gap: var(--gap-words-words); min-width: 0; }
.list-row-title-icon { flex: none; display: inline-flex; color: var(--ink-2); }
.list-row-title-icon > .ico { width: 16px; height: 16px; }
/* A meter under its lines: only the track, its numbers in the detail above. */
.list-row-meter { display: grid; }
.list-row-fact { display: inline-block; max-width: 100%; }
.list-row-end { flex: none; display: inline-flex; align-items: center; gap: var(--gap-words-words); font: var(--type-facts); color: var(--ink-2); }
.list-row-action { flex: none; display: inline-flex; margin-left: auto; }
/* In a row too narrow for its words and its buttons' words both (is-narrow, LIST_ROW_FIT_SCRIPT), an action that has an icon shows its icon
   alone (its words still said to a screen reader), so its buttons always fit beside the words: Mute becomes its speaker, carved in while on. */
.list-row.is-narrow .list-row-action .cut-btn:has(> .face > .ico) > .face { width: 52px; --slab-words: 0px; }
.list-row.is-narrow .list-row-action .cut-btn.small:has(> .face > .ico) > .face { width: 42px; }
.list-row.is-narrow .list-row-action .cut-btn:has(> .face > .ico) > .face > span:not([class]) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
/* A switch row is pressed as a whole (its words are its switch's label): it shows its face as you point at it, as a link row does. */
.list-row.toggle { flex-wrap: nowrap; cursor: pointer; }
/* Its words take what's left beside the switch, however narrow, and wrap there: the switch stays on their line, at the row's end. */
.list-row.toggle > .list-row-words { flex: 1 1 0; }
.list-row.toggle.is-disabled { cursor: default; }
/* The rows a switch row turns on, and what a folding row opens to: in a well under it, a frame gap in from the list's sides and above the
   next row, shown while it's on or open. */
/* A folding row is pressed as a whole, as a link row is, its chevron turning down as it opens. */
.list-row.is-fold { cursor: pointer; list-style: none; }
/* A row that does something: a button as a whole, as wide as the list, its words where a link row's are. */
.list-row.is-press { width: 100%; cursor: pointer; text-align: start; }
.list-row.is-fold::-webkit-details-marker { display: none; }
.list-row.is-fold:hover > .list-row-go, .list-row.is-fold.is-pointed > .list-row-go { color: var(--ink); }
.list-row-fold[open]:not(.is-closing) > .list-row.is-fold > .list-row-go { transform: rotate(90deg); }
.list-rows > li:has(> .list-row .toggle-input:not(:checked)) > .list-row-while-on { display: none; }
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
      label: "Rows that do something: a player's things to do, in a sheet (Report pointed at)",
      markup: html`<div style="width:min(320px,100%)">${glassPane({ paneWidth: "full", body: stackOfOne(listRows({ whenEmpty: NO_EMPTY_NOTE, isCompact: true, label: "Liam", rows: [{ title: "Profile", lead: icon("person"), href: "#list-rows" }, { title: "Block", lead: icon("ban"), press: {} }, { title: "Report", lead: icon("flag"), press: {}, state: "is-pointed" }] })) })}</div>`,
    },
    {
      label: "Rows that open, in a pane among other things: something out of the way, and things to scan by a title and a line, one open",
      isWide: true,
      markup: glassPane({ paneWidth: "full", body: stack({ items: [
        { kind: "words", markup: html`<h2>Privacy</h2>` },
        { kind: "words", markup: html`<p>Who can find you and send you things.</p>` },
        { kind: "block", markup: listRows({ whenEmpty: NO_EMPTY_NOTE, rows: [
          { title: "Blocked", end: tag("3", "count"), fold: { body: html`<p>Mia, Lucas and Oliver can't see you or send you anything.</p>` } },
          { title: "Typed chat", detail: "Can a player type text that another player reads as written?", fold: { isOpen: true, body: html`<p>Fine: chat through room.chat, filtered. Not fine: free text another player reads as written.</p>` } },
          { title: "Gambling", detail: "Can a player stake money on chance?", fold: { body: html`<p>Fine: chance with nothing of value at stake. Not fine: staking money or what's bought with it.</p>` } },
        ] }) },
      ] }) }),
    },
    {
      label: "Compact: a long list in a narrow place, one line a row (the players in a room)",
      markup: html`<div style="width:320px">${glassPane({ paneWidth: "full", body: stackOfOne(listRows({ isCompact: true, whenEmpty: stateNote({ stateKind: "empty", title: "Nobody here yet", text: "Players show here as they join." }), rows: ["Liam", "Sofia", "Emma Charlotte Fairweather-Lindqvist"].map((name, index) => ({ lead: pictureFrame(name, "sm"), title: name, titleIcon: index ? undefined : { icon: "friends" as const, label: "Friend" }, action: [secondaryButton(`Mute ${name}`, { type: "button", icon: "speaker", isLabelHidden: true, isSmall: true }), secondaryButton(`More for ${name}`, { type: "button", icon: "more", isLabelHidden: true, isSmall: true })] })) })) })}</div>`,
    },
    { label: "Pointed", markup: listPane([{ title: "Ashen Crown", detail: "Unlisted · 2,318 players this week", href: "#list-rows", state: "is-pointed" }]), isStill: true },
    { label: "Pressed", markup: listPane([{ title: "Ashen Crown", detail: "Unlisted · 2,318 players this week", href: "#list-rows", state: "is-pressed" }]), isStill: true },
    { label: "Keyboard focus", markup: listPane([{ title: "Ashen Crown", detail: "Unlisted · 2,318 players this week", href: "#list-rows", state: "is-focused" }]), isStill: true },
    { label: "A long title wraps", markup: listPane([{ title: "Ashen Crown: Chronicles of the Long Winter, Definitive Edition", detail: "Listed · 18,420 players this week", href: "#list-rows", end: VERSION_STATE_TAGS.live }]) },
    {
      label: "Led by pictures, a button a row, what each is doing in green",
      isWide: true,
      markup: listPane([
        { lead: pictureFrame("Sofia", "md", { picture: FRAME_SAMPLE_PICTURE }), title: "Sofia", activity: "Playing Ashen Crown", action: secondaryButton("Invite", ROW_BUTTON) },
        { lead: pictureFrame("Liam", "md"), title: "Liam", activity: "Online", action: secondaryButton("Invite", ROW_BUTTON) },
        { lead: pictureFrame("Noah", "md"), title: "Noah", detail: "Played 3 days ago", action: secondaryButton("Invite", ROW_BUTTON) },
      ]),
    },
    {
      label: "A few buttons a row: players in a room (in a narrow row, each button its icon alone)",
      markup: listPane([
        { lead: pictureFrame("Sofia", "md"), title: "Sofia", detail: "Friend", action: [toggleButton("Mute", { ...ROW_BUTTON, icon: "speaker", pressedIcon: "speaker-off", isPressed: false }), secondaryButton("More for Sofia", { ...ROW_BUTTON, icon: "more", isLabelHidden: true })] },
        { lead: pictureFrame("Liam", "md"), title: "Liam", detail: "Muted", action: [toggleButton("Mute", { ...ROW_BUTTON, icon: "speaker", pressedIcon: "speaker-off", isPressed: true }), secondaryButton("More for Liam", { ...ROW_BUTTON, icon: "more", isLabelHidden: true })] },
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
    {
      label: "What needs you on a game: each led by a mark in its tone, linking to where it's dealt with",
      isWide: true,
      markup: fullListPane([
        { lead: icon("warning"), leadTone: "problem", title: "Version 15 is held", detail: "It loads a script from another site", href: "#list-rows" },
        { lead: icon("flag"), leadTone: "warning", title: "3 open reports", detail: "The newest an hour ago", href: "#list-rows" },
        { lead: icon("database"), leadTone: "warning", title: "Database nearly full", detail: "46.2 of 50 MB", href: "#list-rows" },
      ]),
    },
    {
      label: "Forum topics: who started it, its replies, and an answer",
      isWide: true,
      markup: fullListPane([
        { lead: pictureFrame("Sofia", "md"), title: "Rooms drop players after a minute in Safari", detail: "Sofia · 14 replies · an hour ago", end: tag("Answered", "new"), href: "#list-rows" },
        { lead: pictureFrame("lumen_works", "md"), title: "How do I sell a season pass?", detail: "lumen_works · 3 replies · yesterday", href: "#list-rows" },
      ]),
    },
    {
      label: "Recent history: the latest few, the rest folded under Earlier",
      isWide: true,
      markup: glassPane({ paneWidth: "full", body: stackOfOne(listRows({ whenEmpty: NO_EMPTY_NOTE, rows: [
        { lead: icon("upload"), title: "Version 15 uploaded", end: "An hour ago" },
        { lead: icon("play"), title: "Version 14 published", end: "Oct 19" },
        { lead: icon("gear"), title: "Who can play: everyone", end: "Oct 18" },
        { title: "Earlier", end: tag("12", "count"), fold: { rows: [{ title: "Version 13 published", end: "Oct 16" }, { title: "Game made", end: "Oct 2" }] } },
      ] })) }),
    },
    {
      label: "Purchases: what, when and what it cost",
      isWide: true,
      markup: fullListPane([
        { lead: icon("cart"), title: "Season pass · Ashen Crown", detail: "Oct 30 · Visa ending 4242", end: "$9.99", href: "#list-rows" },
        { lead: icon("cart"), title: "Starter pack · Tiny Farm", detail: "Oct 12 · Refunded", end: "$4.99", href: "#list-rows" },
      ]),
    },
    {
      label: "Where you're signed in, each with Sign out",
      isWide: true,
      markup: fullListPane([
        { lead: icon("computer"), title: "Mac · Safari", detail: "Berlin · this device", end: tag("Now", "new") },
        { lead: icon("phone"), title: "iPhone · Safari", detail: "Berlin · 2 days ago", action: secondaryButton("Sign out", ROW_BUTTON) },
      ]),
    },
    { label: "Rows to read, not to open", markup: listPane([{ title: "Claude", detail: "Made Oct 12 · used an hour ago", end: "Reads, uploads" }, { title: "Build server", detail: "Made Sep 30 · used yesterday", end: "Uploads" }]) },
  ],
});

/** What a State note says: there's nothing yet (empty), something went wrong (problem), or a task just ended (done). */
export type StateKind = "empty" | "problem" | "done";

export interface StateNoteOptions {
  stateKind: StateKind;
  /** Left out, the note is its text alone: one line, like a shelf's. "" keeps an empty title for a page script to write (the buy sheet's problem). */
  title?: string;
  text: string;
  /** An id for the text, for a page script that writes it as things change (who's in a room); while it's empty, it's hidden. */
  textId?: string;
  /** What to do about it: one button from Actions, full width (isFullWidth). It sits at the note's foot, so at a pane's foot it takes the pane's cut. */
  action?: ControlMarkup;
}

/**
 * A State note, where content would be: a few words saying what it is and what to do, and at most one button. Empty: what will be here and
 * how it gets here, where a list has nothing yet (the only thing a list takes for whenEmpty). Problem: what went wrong and what to do (Try
 * again), led by a warning mark. Done: what was just done, in place of the task it ends (a report sent), led by a check.
 */
export function stateNote(options: StateNoteOptions & { stateKind: "empty" }): EmptyNoteMarkup;
export function stateNote(options: StateNoteOptions): Raw;
export function stateNote(options: StateNoteOptions): Raw {
  const mark = options.stateKind === "problem" ? icon("warning") : options.stateKind === "done" ? icon("check") : "";
  const note = html`<div class="state-note${options.stateKind === "empty" ? "" : ` ${options.stateKind}`}${options.action ? " has-action" : ""}">${mark}<div class="state-words words-margin">${options.title !== undefined ? html`<p class="state-title">${options.title}</p>` : ""}<p class="state-text"${options.textId ? html` id="${options.textId}"` : ""}${options.text ? "" : raw(" hidden")}>${options.text}</p></div>${options.action ? html`<div class="state-action">${options.action}</div>` : ""}</div>`;
  return options.stateKind === "empty" ? new EmptyNoteMarkup(note.html) : note;
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
  name: "State note",
  slug: "state-note",
  group: "data",
  subgroup: "states",
  summary: "Where content would be, when there's none to show: nothing yet (empty), what will be here and how it gets here; something went wrong (problem), and what to do about it; or a task just ended (done), and what happens next. A few words and at most one button, never a picture. A list's whenEmpty takes only the empty kind. A moment that passes is a Notice instead.",
  styles: STATE_STYLES + WHEN_EMPTY_STYLES,
  render: stateNote,
  examples: [
    { label: "Empty, with what starts it", markup: glassPane({ paneWidth: "fit", body: stackOfOne(stateNote({ stateKind: "empty", title: "No games yet", text: "Make one from your AI, or upload a folder with an index.html from your terminal.", action: primaryButton("Make a game", { type: "button", isFullWidth: true }) })) }) },
    { label: "Empty, words alone", markup: glassPane({ paneWidth: "fit", body: stackOfOne(stateNote({ stateKind: "empty", title: "No friends playing", text: "When a friend plays something, it shows here." })) }) },
    { label: "Problem, with what to do", markup: glassPane({ paneWidth: "fit", body: stackOfOne(stateNote({ stateKind: "problem", title: "Couldn't load your versions", text: "Zaisma didn't answer in time. Nothing is lost.", action: secondaryButton("Try again", { type: "button", isFullWidth: true }) })) }) },
    { label: "Problem, words alone", markup: glassPane({ paneWidth: "fit", body: stackOfOne(stateNote({ stateKind: "problem", title: "This game isn't shown where you are", text: "Its developer keeps it from players in your country." })) }) },
    { label: "Done, with the way on", markup: glassPane({ paneWidth: "fit", body: stackOfOne(stateNote({ stateKind: "done", title: "Report sent", text: "Zaisma looks at it within a day and tells you what it did.", action: secondaryButton("Close", { type: "button", isFullWidth: true }) })) }) },
    { label: "Done, words alone", markup: glassPane({ paneWidth: "fit", body: stackOfOne(stateNote({ stateKind: "done", title: "Version 15 is live", text: "Players get it the next time they open the game." })) }) },
  ],
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
  /** In place of the rows while they come or can't: a Progress with no end known, or a problem State note, under the header. */
  rowsPlaceholder?: Raw;
  /** In place of the rows while there are none: an Empty state, under the header. */
  whenEmpty: EmptyNoteMarkup;
  /** Unique on the page. Defaults to a slug of its caption. */
  id?: string;
  /** Its next rows, a page at a time (a cursor's page): Load more under its last row adds them to it (Navigation's Load more), or its end words once there are no more. */
  moreRows?: Omit<LoadMoreOptions, "listId" | "moreListIds">;
}

/**
 * A table carved into its pane: its rows in a well, hairlines between them, numbers right-aligned in figures of one width; its header row a
 * slab of glass raised in the well's top that stays as the rows scroll under it, and, when the first column names the rows, a second slab
 * down the well's side holding them, staying as the rest scroll sideways under it. On a phone it scrolls sideways inside its well, fading at
 * its edges, under a caption that stays: a row never folds into a card, since developers compare rows.
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
      ? html`<th scope="row">${content}</th>`
      : html`<td${cellClass(columnIndex)}>${options.columns[columnIndex]?.isActions && content instanceof ControlMarkup ? row({ widths: "fit", items: [{ kind: "control", markup: content }] }) : content}</td>`;
  };
  const placeholder = options.rowsPlaceholder ?? (options.rows.length ? null : options.whenEmpty);
  const body = placeholder
    ? html`<tr><td class="table-placeholder" colspan="${String(options.columns.length)}"><div class="table-placeholder-in">${placeholder}</div></td></tr>`
    : options.rows.map((row) => html`<tr>${row.map(cell)}</tr>`);
  const cap = options.shownRowCount ? html` style="--shown-row-count:${String(options.shownRowCount)}"` : "";
  // The slabs are the scroll box's own, beside the table, so they stay where it shows while the rows scroll under them (TABLE_SCRIPT sizes them).
  // Where the header row and the row heads meet, a third: the header's words scroll sideways under it, as the rows' do under the row heads.
  // With no rows (loading, empty), there are no row heads to stand apart: the header is one slab across.
  const slabs = html`${slab({ body: raw(""), isDense: true, kind: "table-head-slab" })}${
    options.hasRowHeads && !placeholder ? html`${slab({ body: raw(""), isDense: true, kind: "table-row-head-slab" })}${slab({ body: raw(""), isDense: true, kind: "table-corner-slab" })}` : ""
  }${placeholder ? "" : raw('<span class="table-frost is-start" aria-hidden="true"></span><span class="table-frost is-end" aria-hidden="true"></span>')}${
    options.hasRowHeads && !placeholder ? raw('<span class="table-frost is-top" aria-hidden="true"></span><span class="table-frost is-bottom" aria-hidden="true"></span>') : ""
  }`;
  const scrollBox = html`<div class="table-scroll${options.shownRowCount ? " is-capped" : ""}"${cap} data-fades-sideways data-side-rail${options.shownRowCount ? "" : raw(" data-scroll-box")}>${slabs}<table class="data-table${options.isCompact ? " compact" : ""}${options.hasRowHeads ? " has-row-heads" : ""}" aria-labelledby="${id}-caption"><thead><tr>${options.columns.map(
    (column) => {
      const names = [column.isNumeric && "num", column.isActions && "actions"].filter(Boolean).join(" ");
      return html`<th scope="col"${names ? html` class="${names}"` : ""}>${column.isActions ? html`<span><span class="sr">${column.label}</span></span>` : column.label}</th>`;
    },
  )}</tr></thead><tbody class="hairlines" id="${id}-rows">${body}</tbody></table></div>`;
  return html`<div class="table"><p class="table-caption words-margin" id="${id}-caption">${options.caption}</p>${well({ kind: "table-well", body: scrollBox })}${options.moreRows ? loadMore({ ...options.moreRows, listId: `${id}-rows` }) : ""}</div>`;
}

/** Sizes a table's slabs to what its well shows: the head slab as wide as the box and as tall as the header row, the row heads' slab as
 * wide as their column and as tall as the box, so each stays whole in view however far the rows scroll. */
export const TABLE_SCRIPT = `/* table slabs */(function () {
  function fit(box) {
    var head = box.querySelector(":scope > table > thead"), rowHead = box.querySelector(":scope > table > tbody > tr > th, :scope > table > thead > tr > th:first-child");
    box.style.setProperty("--shown-width", box.clientWidth + "px"); box.style.setProperty("--shown-height", box.clientHeight + "px");
    if (head) box.style.setProperty("--head-height", head.offsetHeight + "px");
    if (rowHead) box.style.setProperty("--row-head-width", rowHead.offsetWidth + "px");
  }
  var watcher = typeof ResizeObserver === "function" ? new ResizeObserver(function (entries) { entries.forEach(function (entry) { var box = entry.target.closest(".table-scroll"); if (box) fit(box); }); }) : null;
  window.zaismaWatch.each(".table-scroll", function (box) { fit(box); if (watcher) { watcher.observe(box); var table = box.querySelector(":scope > table"); if (table) watcher.observe(table); } });
})();
`;

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
const MATCH_MAPS = ["Ashfall Gate", "Mirewood", "Spire of Glass", "Night Market", "Sunken Vault"];
const MATCH_ROWS: (Raw | string)[][] = Array.from({ length: 16 }, (_, rowIndex) => [
  html`<code>m_${(0x4a10 + rowIndex * 37).toString(16)}</code>`,
  MATCH_MAPS[rowIndex % MATCH_MAPS.length] ?? "",
  rowIndex % 3 === 0 ? "Duel" : "Squads",
  rowIndex % 3 === 0 ? "2" : "8",
  String(540 + ((rowIndex * 97) % 600)),
  ["Ember Watch", "Night Market", "Tidecallers"][rowIndex % 3] ?? "",
  `${12 + (rowIndex * 7) % 30}–${(rowIndex * 5) % 25}`,
  String(14 + ((rowIndex * 23) % 70)),
  (18_000 + ((rowIndex * 7_919) % 64_000)).toLocaleString("en-US"),
  html`<code>srv-${["fra", "iad", "bom"][rowIndex % 3]}-${String(1 + (rowIndex % 4)).padStart(2, "0")}</code>`,
  `1.4.${2 + (rowIndex % 3)}`,
  ["eu-west", "us-east", "ap-south"][rowIndex % 3] ?? "",
  `2026-10-30 ${String(21 - Math.floor(rowIndex / 2)).padStart(2, "0")}:${String((rowIndex * 13 + 47) % 60).padStart(2, "0")}`,
  `2026-10-30 ${String(22 - Math.floor(rowIndex / 2)).padStart(2, "0")}:${String((rowIndex * 13) % 60).padStart(2, "0")}`,
]);
const tablePane = (options: Omit<TableOptions, "whenEmpty">) => glassPane({ paneWidth: "full", body: stackOfOne(table({ whenEmpty: stateNote({ stateKind: "empty", title: "No rows yet", text: "Rows show here as they come." }), ...options })) });

component({
  name: "Table",
  slug: "table",
  group: "data",
  subgroup: "lists",
  summary: "Rows to compare (versions, requests, players, logs), carved into the pane. Its header is a raised slab the rows scroll under, numbers line up on the right, and on a phone it scrolls sideways rather than folding rows into cards.",
  styles: `
/* A table: its caption in a label's words over a well carved into the pane, its rows in the carving with hairlines between them. Its header
   row is a slab of glass raised in the well's top, lit from above and casting its shade on the rows, and stays there as a long table's rows
   scroll under it. A first column that names the rows is a second slab down the well's side, under the header's, staying as the rest scroll
   sideways under it. Both are denser than a pane's glass so the rows under them never show through, and both are cut by the edge rule to
   the well's corners where they meet them. A row under the pointer catches a little light, its head too. */
/* How tall its header and a row stand (a row holding a tag), for a capped table's height. */
/* A row's height is its padding and a line of its words, which grow with the browser's text size: 37px and 51px at the browser's own 16px, 33px and 34px compact. */
.table { display: grid; gap: var(--gap-words-control); min-width: 0; --table-head-height: calc(16px + 1.3125rem); --table-row-height: calc(28px + 1.4375rem); }
.table:has(.compact) { --table-head-height: calc(16px + 1.0625rem); --table-row-height: calc(16px + 1.125rem); }
.table-caption { margin: 0; font: var(--type-label); color: var(--ink); }
.table-well { display: block; min-width: 0; }
.table-well > .well-body { padding: 0; }
/* The box scrolls both ways; its table and its slabs share one cell, as wide as the table, so a slab can stay put across all of it. */
.table-scroll { position: relative; isolation: isolate; display: grid; grid-template-columns: minmax(100%, max-content); max-width: 100%; }
.table-scroll > * { grid-area: 1 / 1; }
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
/* What scrolls fades out at the edges it's scrolled past: sideways from the row heads' edge (from the box's, with none), down from under the
   header. The slabs never fade: the header row and the row heads' column are whole in the mask (glass doesn't go see-through), and the words
   sliding under them fade into the slab's own white instead, by a frost the slab carries over them (.table-frost). The rows fade into the
   well, as everything else does. */
.table-scroll:is(.more-left, .more-right) {
  -webkit-mask-image: linear-gradient(#000, #000), linear-gradient(90deg, #000 var(--row-head-width, 0px), transparent var(--row-head-width, 0px), rgba(0,0,0,0.22) calc(var(--row-head-width, 0px) + var(--fade-left) * 0.35), rgba(0,0,0,0.66) calc(var(--row-head-width, 0px) + var(--fade-left) * 0.7), #000 calc(var(--row-head-width, 0px) + var(--fade-left)), #000 calc(100% - var(--fade-right)), rgba(0,0,0,0.66) calc(100% - var(--fade-right) * 0.7), rgba(0,0,0,0.22) calc(100% - var(--fade-right) * 0.35), transparent 100%); mask-image: linear-gradient(#000, #000), linear-gradient(90deg, #000 var(--row-head-width, 0px), transparent var(--row-head-width, 0px), rgba(0,0,0,0.22) calc(var(--row-head-width, 0px) + var(--fade-left) * 0.35), rgba(0,0,0,0.66) calc(var(--row-head-width, 0px) + var(--fade-left) * 0.7), #000 calc(var(--row-head-width, 0px) + var(--fade-left)), #000 calc(100% - var(--fade-right)), rgba(0,0,0,0.66) calc(100% - var(--fade-right) * 0.7), rgba(0,0,0,0.22) calc(100% - var(--fade-right) * 0.35), transparent 100%);
  -webkit-mask-size: 100% var(--head-height, var(--table-head-height)), 100% 100%; mask-size: 100% var(--head-height, var(--table-head-height)), 100% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-composite: source-over; mask-composite: add; }
.table-scroll.is-capped.scroll-fades.is-fading {
  -webkit-mask-image: linear-gradient(#000, #000), linear-gradient(#000, #000), linear-gradient(90deg, #000 var(--row-head-width, 0px), transparent var(--row-head-width, 0px), rgba(0,0,0,0.22) calc(var(--row-head-width, 0px) + var(--fade-left) * 0.35), rgba(0,0,0,0.66) calc(var(--row-head-width, 0px) + var(--fade-left) * 0.7), #000 calc(var(--row-head-width, 0px) + var(--fade-left)), #000 calc(100% - var(--fade-right)), rgba(0,0,0,0.66) calc(100% - var(--fade-right) * 0.7), rgba(0,0,0,0.22) calc(100% - var(--fade-right) * 0.35), transparent 100%), linear-gradient(to bottom, #000 var(--fade-from, 0px), transparent var(--fade-from, 0px), #000 calc(var(--fade-from, 0px) + var(--fade-top)), #000 calc(100% - var(--fade-bottom)), transparent); mask-image: linear-gradient(#000, #000), linear-gradient(#000, #000), linear-gradient(90deg, #000 var(--row-head-width, 0px), transparent var(--row-head-width, 0px), rgba(0,0,0,0.22) calc(var(--row-head-width, 0px) + var(--fade-left) * 0.35), rgba(0,0,0,0.66) calc(var(--row-head-width, 0px) + var(--fade-left) * 0.7), #000 calc(var(--row-head-width, 0px) + var(--fade-left)), #000 calc(100% - var(--fade-right)), rgba(0,0,0,0.66) calc(100% - var(--fade-right) * 0.7), rgba(0,0,0,0.22) calc(100% - var(--fade-right) * 0.35), transparent 100%), linear-gradient(to bottom, #000 var(--fade-from, 0px), transparent var(--fade-from, 0px), #000 calc(var(--fade-from, 0px) + var(--fade-top)), #000 calc(100% - var(--fade-bottom)), transparent);
  -webkit-mask-size: 100% var(--head-height, var(--table-head-height)), var(--row-head-width, 0px) 100%, 100% 100%, 100% 100%; mask-size: 100% var(--head-height, var(--table-head-height)), var(--row-head-width, 0px) 100%, 100% 100%, 100% 100%;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-composite: source-over, source-over, source-in, source-over; mask-composite: add, add, intersect, add; }
/* The frosts: the slab's white, clearing over the fade's own length, laid over the words sliding under a slab (over the header's words at its
   two ends, over the row heads' words just under the header and at the foot), so they fade into the slab. Each is as long as its fade is now,
   easing with it. */
.table-scroll > .table-frost { position: sticky; top: 0; left: 0; grid-area: 1 / 1; align-self: start; justify-self: start; pointer-events: none;
  background: var(--table-row-head); }
/* The frosts read the box's fade lengths through plain copies (a registered length doesn't pass down to them in Safari). */
.table-scroll { --frost-left: var(--fade-left); --frost-right: var(--fade-right); --frost-top: var(--fade-top); --frost-bottom: var(--fade-bottom); }
.table-scroll > .table-frost.is-start { z-index: 5; left: var(--row-head-width, 0px); margin-left: var(--row-head-width, 0px); width: var(--frost-left); height: var(--head-height, var(--table-head-height));
  -webkit-mask-image: linear-gradient(90deg, #000, transparent); mask-image: linear-gradient(90deg, #000, transparent); }
.table-scroll > .table-frost.is-end { z-index: 5; left: calc(var(--shown-width, 100%) - var(--frost-right)); margin-left: calc(var(--shown-width, 100%) - var(--frost-right)); width: var(--frost-right); height: var(--head-height, var(--table-head-height));
  -webkit-mask-image: linear-gradient(270deg, #000, transparent); mask-image: linear-gradient(270deg, #000, transparent); }
.table-scroll > .table-frost.is-top { z-index: 3; top: var(--head-height, var(--table-head-height)); margin-top: var(--head-height, var(--table-head-height)); width: var(--row-head-width, 0px); height: var(--frost-top);
  -webkit-mask-image: linear-gradient(to bottom, #000, transparent); mask-image: linear-gradient(to bottom, #000, transparent); }
/* The foot's holds to the box's foot by itself, never pushed there by a margin: a margin that tall would make the box grow, and grow again. */
.table-scroll > .table-frost.is-bottom { z-index: 3; top: auto; bottom: 0; align-self: end; width: var(--row-head-width, 0px); height: var(--frost-bottom);
  -webkit-mask-image: linear-gradient(to top, #000, transparent); mask-image: linear-gradient(to top, #000, transparent); }
/* The slabs (Slab, dense; TABLE_SCRIPT sizes them to what shows): the header's across the top, the row heads' down the side, and where they
   meet a corner of their own. They meet edge to edge, all as high as each other, so none shades another: only the rows in the carving
   take their shade, and a low one, since they lie in the well rather than standing out of the pane as a button does. */
.table-scroll > .slab-holder { position: sticky; top: 0; left: 0; display: flex; align-self: start; justify-self: start; pointer-events: none; filter: var(--slab-cast-pressed); }
.table-scroll > .slab-holder > .slab { width: 100%; height: 100%; padding: 0; }
.table-scroll > .table-head-slab { z-index: 3; width: var(--shown-width, 100%); height: var(--head-height, var(--table-head-height)); }
.table-scroll:has(> .table-corner-slab) > .table-head-slab { left: var(--row-head-width, 0px); margin-left: var(--row-head-width, 0px); width: calc(var(--shown-width, 100%) - var(--row-head-width, 0px)); }
.table-scroll > .table-row-head-slab { z-index: 1; top: var(--head-height, var(--table-head-height)); margin-top: var(--head-height, var(--table-head-height)); width: var(--row-head-width, 0px); height: calc(var(--shown-height, 100%) - var(--head-height, var(--table-head-height))); }
/* Its rails lie in the well: the up-down one down its side from under the header row (which never scrolls), the sideways one along its foot
   from past the row heads (which never move). The rows' last column makes room for the up-down one, a frame gap clear of it. */
.table-scroll.shows-rail > .data-table :is(td, th):last-child { padding-inline-end: calc(var(--pad-inside-words) + var(--rail-room)); }
/* The sideways rail's lane is the box's own last row, so the row heads' slab runs down through it beside the rail; the rail lies in it. */
.table-scroll.shows-side-rail { grid-template-rows: auto calc(var(--rail-reach) + var(--rail-inset)); }
.table-scroll > .data-table { grid-row: 1; }
.table-scroll > .slab-holder { grid-row: 1 / -1; }
/* It keeps the frame gap from the well's foot, as the up-down one does from its side. */
.table-scroll.shows-side-rail + .rail.sideways { margin-top: calc(-1 * (var(--rail-reach) + var(--rail-inset))); margin-bottom: var(--rail-inset); }
/* The corner has a slab on both its open sides, so it casts on nothing. */
.table-scroll > .table-corner-slab { z-index: 5; width: var(--row-head-width, 0px); height: var(--head-height, var(--table-head-height)); filter: none; }
.data-table { width: 100%; border-collapse: separate; border-spacing: 0; font: var(--type-words); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.data-table th, .data-table td { white-space: nowrap; text-align: left; }
.data-table thead th { position: sticky; top: 0; z-index: 4; padding: 10px var(--pad-inside-words); font: var(--type-facts); color: var(--ink-2); }
.data-table td, .data-table tbody th { padding: 14px var(--pad-inside-words); }
.data-table tbody th { position: sticky; left: 0; z-index: 2; font: var(--type-label); color: var(--ink); }
.data-table.has-row-heads thead th:first-child { left: 0; z-index: 6; }
/* The row heads sit on their slab, so no hairline runs across it: only the rows' own carving has them. */
.data-table tbody.hairlines > tr + tr > th { border-top-color: transparent; }
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
/* Centered in the well's width, with a pane's room above and below it, so it reads as the table's state, not a row squeezed under its header. */
.table-placeholder-in { position: sticky; left: 0; box-sizing: border-box; width: 100cqi; padding: var(--pad-pane) var(--pad-inside-words); }
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
      label: "A header row that stays: compact and capped, its rows scroll under it",
      isWide: true,
      markup: tablePane({ caption: "Requests to your game server", isCompact: true, shownRowCount: 6, columns: REQUEST_COLUMNS, rows: REQUEST_ROWS }),
    },
    {
      label: "More rows a page at a time: Load more under its last row",
      isWide: true,
      markup: tablePane({
        caption: "Sales",
        id: "example-sales",
        columns: [{ label: "Item" }, { label: "Player" }, { label: "Price", isNumeric: true }, { label: "When" }],
        rows: [["Season pass", "Sofia", "$9.99", "Oct 30"], ["Starter pack", "Liam", "$4.99", "Oct 30"], ["Season pass", "Noah", "$9.99", "Oct 29"]],
        moreRows: { href: "#table", label: "Load more" },
      }),
    },
    {
      label: "A first column that stays: a database table's many columns scroll sideways under it",
      isWide: true,
      markup: tablePane({
        caption: "players",
        hasRowHeads: true,
        isCompact: true,
        columns: [
          { label: "player_id" }, { label: "level", isNumeric: true }, { label: "xp", isNumeric: true }, { label: "coins", isNumeric: true }, { label: "gems", isNumeric: true }, { label: "guild" }, { label: "rank" },
          { label: "last_zone" }, { label: "wins", isNumeric: true }, { label: "losses", isNumeric: true }, { label: "play_time_hours", isNumeric: true }, { label: "region" }, { label: "created_at" }, { label: "updated_at" },
        ],
        rows: [
          [html`<code>p_7f3a</code>`, "42", "1,284,550", "18,204", "320", "Ember Watch", "Diamond II", "Ashfall Gate", "312", "87", "418", "eu-west", "2026-03-14 09:12", "2026-10-30 14:02"],
          [html`<code>p_19c0</code>`, "17", "96,410", "2,950", "0", "", "Silver I", "Mirewood", "41", "39", "52", "us-east", "2026-09-02 18:40", "2026-10-30 13:47"],
          [html`<code>p_c22e</code>`, "63", "4,902,118", "91,377", "1,045", "Night Market", "Master", "Spire of Glass", "1,204", "301", "1,377", "ap-south", "2025-12-21 21:05", "2026-10-29 22:10"],
        ],
      }),
    },
    {
      label: "Both stay: rows scroll under the header row, columns under the first column",
      isWide: true,
      markup: tablePane({
        caption: "matches",
        hasRowHeads: true,
        isCompact: true,
        shownRowCount: 6,
        columns: [
          { label: "match_id" }, { label: "map" }, { label: "mode" }, { label: "players", isNumeric: true }, { label: "length_sec", isNumeric: true }, { label: "winner" }, { label: "score", isNumeric: true },
          { label: "kills", isNumeric: true }, { label: "damage", isNumeric: true }, { label: "server_id" }, { label: "build" }, { label: "region" }, { label: "started_at" }, { label: "ended_at" },
        ],
        rows: MATCH_ROWS,
      }),
    },
    {
      label: "Logs: compact, a level tag, the message wrapping",
      isWide: true,
      markup: tablePane({
        caption: "Your game server's log",
        isCompact: true,
        columns: [{ label: "When" }, { label: "Level" }, { label: "Message", isLongText: true }],
        rows: [
          ["14:02:11", tag("Error", "problem"), "Room 4KQ2 threw in onMessage: Cannot read properties of undefined (reading 'hp') at match.ts:118"],
          ["14:02:09", tag("Warning", "warning"), "Player p_19c0 sent 61 messages in a second; the rest wait"],
          ["14:01:58", tag("Info", "plain"), "Room 4KQ2 started with 4 players"],
        ],
      }),
    },
    { label: "Loading, in place of its rows", isWide: true, markup: tablePane({ caption: "Versions", hasRowHeads: true, columns: VERSION_COLUMNS, rows: [], rowsPlaceholder: progress({ label: "Getting your versions" }) }) },
    {
      label: "Empty, in place of its rows",
      isWide: true,
      markup: tablePane({ caption: "Versions", hasRowHeads: true, columns: VERSION_COLUMNS, rows: [], rowsPlaceholder: stateNote({ stateKind: "empty", title: "No versions yet", text: "Upload a folder with an index.html from your terminal, or from your AI." }) }),
    },
  ],
});

export interface Detail {
  /** What the detail is about, in a few words: Players, Works on, Released. */
  label: string;
  /** The detail itself, in words: Linux, Oct 14, 2026. */
  text?: string;
  /** Or its entries, each with the icon that says it at a glance (Single-player, Online co-op). */
  entries?: { text: string; icon: IconName }[];
}

export interface DetailsOptions {
  details: Detail[];
  /** "across": side by side while they fit, each a quiet label over its words (a game's players and devices). "down": one a line, the
   *  label beside its words, the labels in one column (a version's details, a key's). */
  arrangement: "across" | "down";
  label?: string;
}

/** Details: the fuller account of something, in a few short details, each a quiet label with its words. Key details are its headline. */
export function details(options: DetailsOptions): Raw {
  return html`<dl class="details ${options.arrangement}"${options.label ? html` aria-label="${options.label}"` : ""}>${options.details.map(
    (detail) => html`<div class="detail"><dt>${detail.label}</dt><dd>${detail.entries ? detail.entries.map((entry) => html`<span class="detail-entry">${icon(entry.icon)}<span>${entry.text}</span></span>`) : detail.text ?? ""}</dd></div>`,
  )}</dl>`;
}

/** A game's own pane on its page, as the game page lays it out: its name and maker, its Key details, Play, then its Details. */
function gamePaneExample(facts: GameKeyDetails = { playerCount: 1204, friends: [{ username: "Liam" }, { username: "Sofia" }], playedAtMs: Date.now() - 3 * 24 * HOUR_MS, updatedAtMs: Date.now() - 26 * HOUR_MS, updatesHref: "#details" }): Raw {
  return glassPane({
    paneWidth: "fit",
    label: "Ashen Crown",
    body: stack({
      items: [
        { kind: "words", markup: html`<h1>Ashen Crown</h1>` },
        { kind: "words", markup: html`<p>by ${textLink("Emberlight", "#details", { isQuiet: true })}</p>` },
        { kind: "block", markup: gameKeyDetails(facts) },
        { kind: "block", markup: stack({ items: [
          { kind: "control", markup: primaryButton("Play", { type: "button", isBig: true, isFullWidth: true }) },
          { kind: "block", markup: row({ widths: "lead-fills", label: "Details, Share and Report", items: [
            { kind: "control", markup: secondaryButton("Details", { href: "#details", isBig: true }) },
            { kind: "control", markup: secondaryButton("Share", { type: "button", icon: "share", isLabelHidden: true, isBig: true }) },
            { kind: "control", markup: secondaryButton("Report", { href: "#details", icon: "flag", isLabelHidden: true, isBig: true }) },
          ] }) },
        ] }) },
        { kind: "words", markup: details({ arrangement: "across", label: "About playing it", details: [{ label: "Players", entries: [{ text: "Single-player", icon: "person" }, { text: "Online co-op", icon: "globe" }] }, { label: "Works on", entries: [{ text: "Computer", icon: "computer" }, { text: "Tablet", icon: "tablet" }] }, { label: "Last played", text: "3 days ago" }] }) },
      ],
    }),
  });
}

component({
  name: "Details",
  slug: "details",
  group: "data",
  subgroup: "lists",
  summary: "The fuller account of something, below its Key details: who a game is for and what it runs on, purchases and refunds, a version's or a key's details. Each a quiet label with its words, flush on the pane, a hairline setting each apart: side by side, or one a line.",
  styles: `
/* Details: a quiet label (facts) with its words (a line's), flush on the pane, set apart by hairlines rather than carved, so they read as the
   fine print under a page's Key details. Across: side by side while they fit, each label over its words under a hairline of its own. Down:
   one a line, the labels in a column of their own, as wide as the longest, a hairline between lines. */
.details { margin: 0; min-width: 0; }
/* In a pane as wide as what's in it, details wrap rather than widen it past a card and a half: a game's pane stays compact however many ways
   it's played. Narrower than that where the pane has less room, they wrap inside their margin, never into it. */
.glass-pane.fit .details { max-width: calc(1.5 * var(--size-card)); }
.details.across { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr)); gap: var(--gap-words-control) var(--gap-block-block); }
.details.across > .detail { display: grid; align-content: start; gap: var(--gap-words-words); min-width: 0; padding-top: var(--gap-words-words); border-top: var(--divider); }
.details.down { display: grid; grid-template-columns: fit-content(40%) minmax(0, 1fr); align-items: baseline; column-gap: var(--gap-block-block); }
/* Each line spans both columns (a subgrid of them), so its hairline runs unbroken from its label to the end of its words. */
.details.down > .detail { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: baseline; padding-block: var(--gap-words-words); }
.details.down > .detail:first-child { padding-top: 0; }
.details.down > .detail:last-child { padding-bottom: 0; }
.details.down > .detail + .detail { border-top: var(--divider); }
.details.down > .detail > :is(dt, dd) { min-width: 0; }
.detail dt { font: var(--type-facts); color: var(--muted); }
.detail dd { margin: 0; display: flex; flex-wrap: wrap; gap: var(--gap-words-words) var(--gap-words-control); font: var(--type-words); color: var(--ink); overflow-wrap: anywhere; }
/* An entry: its line icon, quiet, then its words. */
.detail-entry { display: inline-flex; align-items: center; gap: var(--gap-words-words); white-space: nowrap; }
.detail-entry > .ico { color: var(--muted); }
`,
  render: details,
  examples: [
    { label: "On a game's pane: under Play, after its Key details", isWide: true, markup: gamePaneExample() },
    {
      label: "Across: a game's players and devices",
      isWide: true,
      markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: details({ arrangement: "across", label: "About this game", details: [{ label: "Players", entries: [{ text: "Single-player", icon: "person" }, { text: "Online co-op", icon: "globe" }] }, { label: "Works on", entries: [{ text: "Computer", icon: "computer" }, { text: "Tablet", icon: "tablet" }] }] }) }] }) }),
    },
    {
      label: "Across: an update that's no longer news, and when you last played",
      isWide: true,
      markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: details({ arrangement: "across", label: "About playing it", details: [{ label: "Players", entries: [{ text: "Single-player", icon: "person" }] }, { label: "Updated", text: "Oct 2" }, { label: "Last played", text: "3 days ago" }] }) }] }) }),
    },
    {
      label: "Down: a version's details",
      markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: details({ arrangement: "down", label: "Version 14", details: [{ label: "Status", text: "Live since Oct\u00a014, 2026" }, { label: "Files", text: "312 files, 48 MB" }, { label: "Scanned", text: "Passed in 41 seconds" }, { label: "Uploaded by", text: "the_longest_username_allowed with Zaisma CLI 1.4" }] }) }] }) }),
    },
    {
      label: "Across, longer: what happens to a version",
      isWide: true,
      markup: glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "words", markup: details({ arrangement: "across", details: [
        { label: "Review", text: "Each version is checked for malware and reviewed against each rule's test, usually within minutes." },
        { label: "Rejection", text: "A version that breaks a rule is rejected with the rule, the finding and the fix." },
        { label: "Appeal", text: "To contest a decision, message Zaisma about the version. A person replies, usually within a day." },
      ] }) }] }) }),
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
  /** A line over time (the default), bars over time, one a point, or shares of a whole, one a point, split along a groove. */
  chartKind?: "line" | "bars" | "shares";
  /** The gallery's fixed state: the point at this place in points is pointed at, showing its dot and its number. */
  pointedIndex?: number;
  /** Its game's glass tint (a game's glass_tint_color), when it's about one game: its line, bars and shares are drawn in it. Left out, in
   *  Zaisma's blue (--part-0). */
  tintColor?: string;
  /** In place of the plot while there are no points: an Empty state. Left out, "No <unit> yet". */
  whenEmpty?: EmptyNoteMarkup;
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
/** A point's mark: a small diamond, cut by the edge rule (data-cut-diamond) as a PIN's marks are, never a round dot. */
const chartMark = (className: string): Raw => html`<span class="${className}" data-cut-line="6" data-cut-diamond>${CUT_LINE}</span>`;
/** A chart's one tip: thin glass with its own edge, the menus' corners, over the plot by the point pointed at (CHART_SCRIPT moves it and
 * fills in the point's number and label). It sits outside the chart's well, never in it: the well clips itself to its cut, and glass in a
 * clipped box can't blur what's under it. */
const CHART_TIP = html`<span class="chart-tip glass thin" data-glass data-glass-corners="menu" aria-hidden="true">${EDGE}<b></b><span></span></span>`;
/** Past this many points a line is too close-packed to show every point's node (they'd read as beads): only its latest shows, and a pointed
 * one grows out of the line. */
const DENSE_LINE_POINT_COUNT = 40;
/** Bars keep at least a seventh of the width each: a few bars stand side by side in the middle, so one bar is never a slab. */
const LEAST_BAR_SLOT_COUNT = 7;

/**
 * A chart, drawn here as SVG, so there's nothing to wait for. Over time, a line or bars on a hairline grid in round steps, its numbers in a
 * column of their own at the left so nothing drawn crosses them, the line (or bars) in ink and the last point marked with its number.
 * Pointing at a point shows its number, and so does tabbing to the chart and stepping along its points with the arrow keys. On a narrow
 * screen every point keeps its room and the chart scrolls sideways, starting at the latest. A table with the same numbers sits behind it
 * for screen readers (in a hidden box: a table never shrinks to one), so the drawing is hidden from them.
 * Shares of a whole split one groove: each share a length of it, biggest first and in the chart's color whole, each after fainter, with a
 * key under it naming each with its share and number.
 */
export function chart(options: ChartOptions): Raw {
  const tint = options.tintColor ? html` style="--chart-color:${options.tintColor}"` : "";
  // None yet: the chart keeps its shape (its slabs and its plot's room), so nothing jumps when the first points come, and an Empty state
  // sits in its plot, with no grid, which would only measure nothing.
  if (options.points.length === 0)
    return html`<figure class="chart"${tint}><figcaption class="chart-label words-margin">${options.label}</figcaption>${well({ kind: "chart-well", body: html`<div class="chart-body"><div class="chart-scale-cell">${slab({ body: raw(""), isDense: true })}<div class="chart-scale"></div></div>${slab({ body: raw(""), isDense: true, kind: "chart-axis-slab" })}<div class="chart-scroll"><div class="chart-inner"><div class="chart-plot"><div class="chart-empty">${options.whenEmpty ?? stateNote({ stateKind: "empty", title: `No ${options.unit} yet`, text: `They show here as they come.` })}</div></div><div class="chart-axis"></div></div></div></div>` })}</figure>`;
  if (options.chartKind === "shares") return sharesChart(options, tint);
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
    : html`<span class="chart-last${pointCount === 1 ? " is-alone" : ""}" style="left:${percent(acrossNumber(pointCount - 1), widthNumber)}%;top:${downPct(last.amountNumber)}%">${chartMark("chart-mark")}<span class="chart-last-words">${chartWords(last.amountNumber)}</span></span>`;
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
    // A bar's own place, filled whole in the chart's color while it's pointed at: the bar lit, nothing behind it.
    const barLight = isBars ? html`<span class="chart-hit-bar" aria-hidden="true"></span>` : "";
    return html`<span class="chart-hit${place}${height}${pointed}" data-tip-amount="${chartWords(point.amountNumber)} ${options.unit}" data-tip-label="${point.label}" style="left:${leftPct.toFixed(2)}%;width:${(rightPct - leftPct).toFixed(2)}%;--point-left:${(((centerPct - leftPct) / Math.max(rightPct - leftPct, 0.01)) * 100).toFixed(2)}%;--point-top:${downPct(point.amountNumber)}%">${barLight}${isBars ? "" : chartMark("chart-dot")}</span>`;
  });
  // Under the plot, on the dates' slab, the points' labels at steady steps, so a chart scrolled anywhere shows some: every point a label's
  // room apart at the least room a point keeps (a line's every 6th, bars' every 3rd), the first at the start, the last at the end. A label
  // less than a step from the last gives way to it. Under a few bars, centered on them (the first only when there's room beside the last).
  const centeredLabel = (pointIndex: number) => html`<span class="is-middle" style="left:${percent(acrossNumber(pointIndex), widthNumber)}%">${points[pointIndex]!.label}</span>`;
  const stepCount = isBars ? 3 : 6;
  const steppedIndexes = Array.from({ length: Math.ceil(pointCount / stepCount) }, (_, stepIndex) => stepIndex * stepCount).filter((pointIndex) => pointIndex === 0 || pointCount - 1 - pointIndex >= stepCount);
  const axis =
    pointCount === 1
      ? centeredLabel(0)
      : isBars && pointCount < LEAST_BAR_SLOT_COUNT
        ? html`${pointCount >= 3 ? centeredLabel(0) : ""}${centeredLabel(pointCount - 1)}`
        : html`${steppedIndexes.map((pointIndex) =>
            pointIndex === 0
              ? html`<span style="left:${percent(isBars ? barLeftNumber(0) : 0, widthNumber)}%">${points[0]!.label}</span>`
              : centeredLabel(pointIndex),
          )}<span class="is-end" style="right:${isBars ? percent(widthNumber - barLeftNumber(pointCount - 1) - barWidthNumber, widthNumber) : "0"}%">${last.label}</span>`;
  const grid = [1, 0.5, 0];
  // Carved into its pane: its scale on a slab down the well's side, its dates on a slab along its foot, under the plot's box rather than in
  // it, so it stays whole as the plot scrolls and fades over it; the sideways rail inside the plot just over the dates.
  return html`<figure class="chart" tabindex="0" data-chart-points${tint}><figcaption class="chart-label words-margin">${options.label}</figcaption>${well({ kind: "chart-well", body: html`<div class="chart-body" aria-hidden="true"><div class="chart-scale-cell">${slab({ body: raw(""), isDense: true })}<div class="chart-scale"><span class="chart-scale-widest">${scaleWords(topNumber)}</span>${grid.map(
    (shareNumber) => html`<span style="top:${((1 - shareNumber) * 100).toFixed(0)}%">${scaleWords(topNumber * shareNumber)}</span>`,
  )}</div></div>${slab({ body: raw(""), isDense: true, kind: "chart-axis-slab" })}<div class="chart-scroll" data-fades-sideways data-side-rail data-chart-scroll><div class="chart-inner${isBars ? " is-bars" : ""}${!isBars && pointCount > DENSE_LINE_POINT_COUNT ? " is-dense" : ""}" style="--point-count:${pointCount}"><div class="chart-plot">${grid.map(
    (shareNumber) => html`<span class="chart-grid" style="top:${((1 - shareNumber) * 100).toFixed(0)}%"></span>`,
  )}${area}<svg class="chart-drawing" viewBox="0 0 ${widthNumber} ${heightNumber}" preserveAspectRatio="none">${drawing}</svg>${lastMark}${hits}</div><div class="chart-axis">${axis}</div></div></div></div>` })}${CHART_TIP}<div class="sr"><table><caption>${options.label}</caption><tbody>${points.map(
    (point) => html`<tr><th scope="row">${point.label}</th><td>${chartWords(point.amountNumber)} ${options.unit}</td></tr>`,
  )}</tbody></table></div></figure>`;
}

/** One share of a whole: its name, its share in whole percent, and its number in words when it has one. */
interface Share {
  label: string;
  sharePct: number;
  amountWords?: string;
}

/** Shares as rows, biggest first: each its name, a groove of its own lit as far as its share, its share and its number. Length alone
 *  compares them, so every groove is in its owner's one color: a chart's color, or a Usage meter's light. Quiet, they're notes under
 *  something bigger (a Usage meter's parts under its track): small words over a hairline groove each, so the track above them leads. */
function shareRows(shares: Share[], label: string, isQuiet = false): Raw {
  return html`<ul class="share-rows${isQuiet ? " is-quiet" : ""}" aria-label="${label}">${shares.map(
    (share) => html`<li class="flush-row quiet" data-cut-line="8">${CUT_LINE}<span class="share-name">${share.label}</span>${groove({ kind: "share-groove", filledPct: share.sharePct })}<b class="share-pct">${String(share.sharePct)}%</b>${share.amountWords ? html`<span class="share-amount">${share.amountWords}</span>` : ""}</li>`,
  )}</ul>`;
}

/** Shares of a whole, on the pane as a Usage meter is: the whole's number, then a row for each share, biggest first. */
function sharesChart(options: ChartOptions, tint: Raw | ""): Raw {
  const totalNumber = options.points.reduce((sumNumber, point) => sumNumber + point.amountNumber, 0) || 1;
  const shares: Share[] = [...options.points]
    .sort((one, other) => other.amountNumber - one.amountNumber)
    .map((point) => ({ label: point.label, sharePct: Math.round((point.amountNumber / totalNumber) * 100), amountWords: `${chartWords(point.amountNumber)} ${options.unit}` }));
  return html`<figure class="chart"${tint}><figcaption class="chart-label words-margin">${options.label}</figcaption><div class="shares-body"><p class="shares-total words-margin"><b>${chartWords(totalNumber)}</b> ${options.unit}</p>${shareRows(shares, options.label)}</div></figure>`;
}

/**
 * A chart that scrolls sideways starts at its latest points. The chart itself is one tab stop: focused from the keyboard, its latest point
 * shows its number, and the arrow keys, Home and End step along its points, scrolling each into view. Screen readers read its table instead.
 */
export const CHART_SCRIPT = `/* charts */(function () {
  window.zaismaWatch.each("[data-chart-scroll]", function (scroll) { scroll.scrollLeft = scroll.scrollWidth; });
  function focusPoint(chart, hits, to) {
    hits.forEach(function (hit, hitIndex) { hit.classList.toggle("is-focused", hitIndex === to); });
    var scroll = chart.querySelector("[data-chart-scroll]"), hit = hits[to];
    if (!scroll || !hit) return;
    var box = scroll.getBoundingClientRect(), place = hit.getBoundingClientRect();
    if (place.left < box.left) scroll.scrollLeft -= box.left - place.left;
    else if (place.right > box.right) scroll.scrollLeft += place.right - box.right;
    if (chart.matches(":focus-visible")) requestAnimationFrame(function () { tipAt(chart, hit); });
  }
  function pointsOf(chart) { return Array.prototype.slice.call(chart.querySelectorAll(".chart-hit")); }
  // The chart's one tip: filled with the point's number and label, placed at the point (from its hit's --point-left and --point-top),
  // opening the way its hit says (toward the middle, below near the top); gone when there's no point.
  function tipAt(chart, hit) {
    var tip = chart.querySelector(":scope > .chart-tip"); if (!tip) return;
    chart.classList.toggle("shows-tip", Boolean(hit));
    if (!hit) { tip.classList.remove("is-shown"); return; }
    tip.querySelector("b").textContent = hit.getAttribute("data-tip-amount"); tip.querySelector("span").textContent = hit.getAttribute("data-tip-label");
    var box = chart.getBoundingClientRect(), place = hit.getBoundingClientRect(), style = getComputedStyle(hit);
    var isBar = Boolean(hit.closest(".is-bars"));
    tip.style.setProperty("--tip-left", (place.left - box.left + place.width * parseFloat(style.getPropertyValue("--point-left")) / 100) + "px");
    tip.style.setProperty("--tip-top", (place.top - box.top + place.height * parseFloat(style.getPropertyValue("--point-top")) / 100) + "px");
    tip.classList.toggle("is-end", hit.classList.contains("is-end"));
    tip.classList.toggle("is-middle", isBar && !hit.classList.contains("is-end") && !hit.classList.contains("is-start"));
    tip.classList.toggle("is-high", hit.classList.contains("is-high"));
    tip.classList.add("is-shown");
  }
  document.addEventListener("pointerover", function (event) {
    var hit = event.target instanceof Element ? event.target.closest(".chart-hit") : null; if (!hit) return;
    tipAt(hit.closest(".chart"), hit);
  });
  document.addEventListener("pointerout", function (event) {
    var hit = event.target instanceof Element ? event.target.closest(".chart-hit") : null; if (!hit) return;
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest(".chart-hit")) return;
    var chart = hit.closest(".chart"), still = chart.querySelector(".chart-hit.is-pointed") || (chart.matches(":focus-visible") ? chart.querySelector(".chart-hit.is-focused") : null);
    tipAt(chart, still);
  });
  // A scroll moves the points from under it: it goes, as it would on a pointer leaving.
  document.querySelectorAll("[data-chart-scroll]").forEach(function (scroll) { scroll.addEventListener("scroll", function () { var chart = scroll.closest(".chart"); tipAt(chart, chart.querySelector(".chart-hit.is-pointed")); }, { passive: true }); });
  document.addEventListener("focusout", function (event) {
    var chart = event.target instanceof Element && event.target.matches("[data-chart-points]") ? event.target : null; if (!chart) return;
    tipAt(chart, chart.querySelector(".chart-hit.is-pointed"));
  });
  // The gallery's still pointed point shows its tip from the start.
  document.querySelectorAll(".chart-hit.is-pointed").forEach(function (hit) { tipAt(hit.closest(".chart"), hit); });
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
const chartPane = (options: ChartOptions) => glassPane({ paneWidth: "full", body: stackOfOne(chart(options)) });

component({
  name: "Chart",
  slug: "chart",
  group: "data",
  subgroup: "numbers",
  summary: "How something moved over time, drawn on the page with nothing to wait for: a line or bars on a hairline grid, the last point marked with its number, and any point's number where you point or step with the arrow keys. Or how a whole splits, as a row for each share with a groove lit as far as it. Screen readers get the same numbers.",
  styles: `
/* A chart over time: its label, then its scale's numbers in a column of their own and the plot beside it, the first and last points' labels
   under the plot. The drawing stretches to the plot while its line keeps its 2px. On a narrow screen each point keeps at least its room
   (--point-room) and the plot scrolls sideways under a scale that stays. The last point is an ink dot with its number over it; pointing at
   any point, or focusing it, shows its dot and its number (a bar's column brightens), its words kept inside the plot at the ends. */
/* Its color: its game's tint (tintColor) when it's about one game, so each game's charts feel its own; otherwise Zaisma's blue. The line,
   the last bar and the biggest share in it whole, the other bars lighter, the shade under a line and the smaller shares fainter. */
.chart { display: grid; gap: var(--gap-block-block); margin: 0; min-width: 0; --chart-color: var(--part-0); }
.chart-label { font: var(--type-label); color: var(--ink); }
/* Carved into its pane, as a table is: the well holds it edge to edge. Its scale is a slab down the well's side, as tall as the well; its dates a
   slab along the well's foot, under the plot's box, so it stays whole as the plot scrolls and fades over it. The two meet edge to edge at
   one height. A chart that scrolls keeps a lane in its plot just over the dates for its sideways rail, which lies in it a frame gap from the
   scale, the well's side and the dates; it never scrolls up and down, so it has no other. */
.chart-well { display: block; min-width: 0; --chart-axis-height: calc(16px + 1.0625rem); }
.chart-well > .well-body { padding: 0; }
.chart-body { display: grid; grid-template-columns: auto minmax(0, 1fr); }
.chart-scale-cell { position: relative; padding: var(--gap-block-block) var(--gap-words-control) 0 var(--pad-inside-words); }
.chart-scale-cell > .slab-holder { position: absolute; inset: 0; display: flex; pointer-events: none; filter: var(--slab-cast-pressed); }
.chart-scale-cell > .slab-holder > .slab { width: 100%; height: 100%; padding: 0; }
.chart-scale { position: relative; z-index: 1; height: 180px; min-width: 32px; font: var(--type-facts); color: var(--ink-2); font-variant-numeric: tabular-nums; text-align: right; }
.chart-scale > span { position: absolute; right: 0; transform: translateY(-50%); white-space: nowrap; }
/* The scale is as wide as its widest amount (the top one, unseen, in its own place), so every amount stays inside the words margin. */
.chart-scale > .chart-scale-widest { position: static; display: block; visibility: hidden; transform: none; }
.chart-scroll { grid-area: 1 / 2; position: relative; z-index: 1; min-width: 0; padding-top: var(--gap-block-block); }
.chart-body > .chart-axis-slab { grid-area: 1 / 2; align-self: end; display: flex; height: var(--chart-axis-height); pointer-events: none; filter: var(--slab-cast-pressed); }
.chart-body > .chart-axis-slab > .slab { width: 100%; height: 100%; padding: 0; }
/* Its nodes at the ends keep their whole diamond inside its padding, and its numbers and tips open inward, so nothing reaches past its
   sides to make it scroll. It clips nothing: a clip would stop the tip's glass blurring what's under it. */
.chart-inner { display: grid; grid-template-rows: auto var(--gap-words-control) var(--chart-axis-height); --point-room: 12px; min-width: calc(var(--point-count) * var(--point-room)); padding: 0 calc(6px + var(--gap-words-control)); }
.chart-scroll.shows-side-rail .chart-inner { grid-template-rows: auto calc(var(--rail-reach) + 2 * var(--rail-inset)) var(--chart-axis-height); }
/* The rail lies in that lane, a frame gap over the dates and in from the scale and the well's side. */
.chart-body > .rail.sideways { margin-top: calc(-1 * (var(--chart-axis-height) + var(--rail-reach) + var(--rail-inset))); margin-bottom: calc(var(--chart-axis-height) + var(--rail-inset)); }
.chart-body > .rail.sideways > .rail-line { left: var(--rail-inset); right: var(--rail-inset); }
.chart-inner.is-bars { --point-room: 26px; }
.chart-plot { position: relative; height: 180px; }
.chart-grid { position: absolute; left: 0; right: 0; height: 0; border-top: var(--divider); }
.chart-drawing { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.chart-line { fill: none; stroke: var(--chart-color); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart-area { fill: color-mix(in srgb, var(--chart-color) 18%, transparent); stroke: none; }
/* The shade under a line fades out at its ends and toward its foot, so it never stops in a hard edge. */
.chart-area-drawing { -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent), linear-gradient(#000 40%, transparent);
  -webkit-mask-composite: source-in; mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent), linear-gradient(#000 40%, transparent); mask-composite: intersect; }
.chart-bar { fill: color-mix(in srgb, var(--chart-color) 45%, transparent); }
.chart-bar.last { fill: var(--chart-color); }
/* The last point: a place with no size of its own at the point, holding its mark and its number. */
.chart-last { position: absolute; width: 0; height: 0; pointer-events: none; }
.chart-mark { position: absolute; left: -6px; top: -6px; width: 12px; height: 12px; background: var(--chart-color); clip-path: var(--cut-shape); }
.chart-last-words { position: absolute; right: -6px; bottom: 9px; font: var(--type-label); color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; transition: opacity var(--motion-state); }
.chart-last.is-alone .chart-last-words { right: auto; left: 50%; transform: translateX(-50%); }
/* Over the last bar, its number centered on it, however wide: the chart's padding past its last bar leaves room for it. */
.chart-last.is-bar { height: 0; margin: 0; background: none; border-radius: 0; box-shadow: none; }
.chart-last.is-bar .chart-last-words { right: auto; left: 50%; bottom: 6px; transform: translateX(-50%); }
.chart-body > .rail { grid-column: 2; }
.chart-axis { grid-row: 3; display: grid; align-items: center; font: var(--type-facts); color: var(--ink-2); }
.chart-axis > span { grid-area: 1 / 1; justify-self: start; position: relative; white-space: nowrap; }
.chart-axis > .is-end { justify-self: end; }
.chart-axis > .is-middle { transform: translateX(-50%); }
.chart-hit { position: absolute; top: 0; bottom: 0; z-index: 2; }
/* Focused from the keyboard, the chart shows its focused point as pointed at, its node or bar ringed in the focus color. */
.chart:focus-visible { outline: none; }
/* Every point of a line is a node on it, lighter in the chart's color, so nothing appears from nowhere: pointing at one fills it in the
   color whole, as the latest is. A line too close-packed for them (is-dense) shows none at rest; a pointed one grows out of
   the line at its point. */
.chart-dot { position: absolute; left: var(--point-left); top: var(--point-top); width: 10px; height: 10px; margin: -5px 0 0 -5px; --face-color: color-mix(in srgb, var(--chart-color) 40%, var(--carving-face)); background: var(--face-color); clip-path: var(--cut-shape); transition: --face-color var(--motion-state), transform var(--motion-state) var(--ease-spring); }
/* Pointed, it fills in the color and grows out from its point, springing to half again its size, so it stands out from the rest. */
.chart-hit:is(:hover, .is-pointed) .chart-dot, .chart:focus-visible .chart-hit.is-focused .chart-dot { --face-color: var(--chart-color); transform: scale(1.6); }
.chart:focus-visible .chart-hit.is-focused .chart-dot { --face-color: var(--focus); }
.chart-inner.is-dense .chart-dot { transform: scale(0); }
.chart-inner.is-dense .chart-hit:is(:hover, .is-pointed) .chart-dot, .chart:focus-visible .chart-inner.is-dense .chart-hit.is-focused .chart-dot { transform: scale(1.6); }
/* A pointed bar: its own place lit whole in the chart's color, over the lighter bar, as the latest is. */
.chart-hit-bar { position: absolute; left: 18%; width: 64%; top: var(--point-top); bottom: 0; background: var(--chart-color); opacity: 0; transition: opacity var(--motion-state); }
.chart-hit:is(:hover, .is-pointed) .chart-hit-bar, .chart:focus-visible .chart-hit.is-focused .chart-hit-bar { opacity: 1; }
.chart:focus-visible .chart-hit.is-focused .chart-hit-bar { outline: 2px solid var(--focus); outline-offset: 2px; }
/* The tip: one piece of thin glass a chart, with its own edge and the menus' corners, floating over the plot by the point pointed at
   (CHART_SCRIPT places it, --tip-left and --tip-top, and fills it in). It opens above the point, toward the middle of the chart, and below
   it near the top. As a floating pane does, it fades its glass and its words, never itself: glass faded as a whole blurs nothing behind it
   until it's whole. */
.chart { position: relative; }
.chart-tip.glass { position: absolute; z-index: 4; left: var(--tip-left, 0); top: var(--tip-top, 0); transform: translate(-12px, calc(-100% - 12px)); display: grid; padding: 6px var(--pad-inside-words); white-space: nowrap;
  font: var(--type-facts); color: var(--ink-2); visibility: hidden; transition: var(--glass-transition), visibility 0s var(--motion-state); pointer-events: none; }
.chart-tip.glass::before, .chart-tip.glass > * { opacity: 0; transition: opacity var(--motion-state); }
.chart-tip.is-shown { visibility: visible; transition: var(--glass-transition), visibility 0s; }
.chart-tip.is-shown::before, .chart-tip.is-shown > * { opacity: 1; }
.chart-tip.is-end { transform: translate(calc(-100% + 12px), calc(-100% - 12px)); }
.chart-tip.is-middle { transform: translate(-50%, calc(-100% - 12px)); }
.chart-tip.is-high { transform: translate(-12px, 12px); }
.chart-tip.is-high.is-end { transform: translate(calc(-100% + 12px), 12px); }
.chart-tip.is-high.is-middle { transform: translate(-50%, 12px); }
.chart-tip b { font-weight: 600; color: var(--ink); }
/* While any point's number shows, the last point's steps aside, so the two never meet: by the tip's own class (CHART_SCRIPT), since Safari
   doesn't always look again at a :has() over :hover once the pointer has gone, and the last number stayed away. */
.chart.shows-tip .chart-last-words { opacity: 0; }
/* No points yet: it says so where the plot would be, over the plot's foot line. */
.chart-empty { position: absolute; inset: 0; display: grid; place-items: center; }
/* Shares of a whole, on the pane with no well, as a Usage meter is: the whole's number, then its share rows (shared with Usage meter). */
.shares-body { display: grid; gap: var(--gap-words-words); }
.shares-total { margin: 0; font: var(--type-facts); color: var(--muted); }
.shares-total b { font: var(--type-section); color: var(--ink); font-variant-numeric: tabular-nums; }
/* Share rows: a row for each share, no hairlines between (each row's groove parts it from the next), its name, its groove lit as far as its share, its share and its number, lined up down the
   rows so the grooves start and end together and their lengths compare. A chart's grooves light in its color. In a narrow box the groove
   takes a line of its own under the words, so it keeps its length, edge to edge of the row as a meter's track is; the last row ends at its
   groove, so at a pane's foot it takes the pane's corners as a track does. Its words keep the words margin of the words over them. Each
   row is cut by the edge rule, so the last one's face follows a pane's corners when it's pointed at. */
.share-rows { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr) auto auto; column-gap: var(--gap-words-control); container-type: inline-size; }
.share-rows:not(:has(.share-amount)) { grid-template-columns: max-content minmax(0, 1fr) auto; }
.share-rows li { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; --row-height: 0px; --row-block: var(--gap-words-words); --row-start: var(--pad-words); --row-end: var(--pad-words); font: var(--type-facts); color: var(--ink-2); }
.share-name { overflow-wrap: break-word; color: var(--ink); }
.share-pct { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; text-align: right; }
.share-amount { color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
.chart .share-groove .groove-light { background: var(--chart-color); }
.chart .share-groove .groove-fill { filter: none; }
@container (max-width: 26rem) {
  .share-rows li { grid-template-columns: minmax(0, 1fr) auto auto; grid-template-areas: "name pct amount" "groove groove groove"; row-gap: var(--gap-words-words); }
  .share-rows:not(:has(.share-amount)) li { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "name pct" "groove groove"; }
  .share-name { grid-area: name; } .share-groove { grid-area: groove; } .share-pct { grid-area: pct; } .share-amount { grid-area: amount; }
  .share-rows .share-groove { margin-inline: calc(-1 * var(--row-start)) calc(-1 * var(--row-end)); }
  .share-rows li:last-child { padding-bottom: 0; }
}
/* Quiet share rows (a Usage meter's parts): at any width each row is its name and share over a hairline groove edge to edge, close
   together, its light fainter, with no face where you point: notes on the track over them, never meters of their own. */
.share-rows.is-quiet li { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "name pct" "groove groove"; row-gap: 4px; --row-block: 6px; }
.share-rows.is-quiet .share-name { grid-area: name; color: var(--ink-2); } .share-rows.is-quiet .share-pct { grid-area: pct; font-weight: 500; }
.share-rows.is-quiet .share-groove { grid-area: groove; margin-inline: calc(-1 * var(--row-start)) calc(-1 * var(--row-end)); }
.share-rows.is-quiet .share-groove.carving.deep.line { height: 6px; }
.share-rows.is-quiet .share-groove .groove-light { opacity: 0.6; }
.share-rows.is-quiet li:last-child { padding-bottom: 0; }
/* In a list row (a Usage meter's track alone under the row's words), the parts' names line up with the row's own words, and their grooves with its track. */
.list-row-meter .share-rows { --pad-words: 0px; }
`,
  render: chart,
  examples: [
    { label: "A line: plays a day", isWide: true, markup: chartPane({ label: "Plays a day", points: DAILY_PLAYS, unit: "plays" }) },
    { label: "Bars, in its game's tint (Neon Drift's violet): players a day", isWide: true, markup: chartPane({ tintColor: "#9B4DFF", label: "Players a day", points: DAILY_PLAYS.map((point) => ({ label: point.label, amountNumber: Math.round(point.amountNumber * 0.31) })), unit: "players", chartKind: "bars" }) },
    { label: "Many points: on a phone, it scrolls sideways from the latest", isWide: true, markup: chartPane({ label: "Players a week", points: MONTHLY_PLAYERS, unit: "players", chartKind: "bars" }) },
    {
      label: "Ninety days of bars: scrolls sideways on any screen, from the latest, under its scale and over its dates",
      isWide: true,
      markup: chartPane({ label: "Players a day", unit: "players", chartKind: "bars", points: Array.from({ length: 90 }, (_, dayIndex) => {
        const day = new Date(Date.UTC(2026, 7, 3 + dayIndex));
        return { label: day.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), amountNumber: Math.round(220 + 140 * Math.sin(dayIndex / 9) + dayIndex * 3 + ((dayIndex * 37) % 50)) };
      }) }),
    },
    { label: "Pointed", isWide: true, isStill: true, markup: chartPane({ label: "Plays a day", points: DAILY_PLAYS, unit: "plays", pointedIndex: 5 }) },
    { label: "One point: the first day", markup: chartPane({ label: "Plays a day", points: [{ label: "Oct 21", amountNumber: 214 }], unit: "plays" }) },
    { label: "Three bars", markup: chartPane({ label: "Players a day", points: [{ label: "Oct 19", amountNumber: 96 }, { label: "Oct 20", amountNumber: 188 }, { label: "Oct 21", amountNumber: 241 }], unit: "players", chartKind: "bars" }) },
    { label: "None yet", markup: chartPane({ label: "Plays a day", points: [], unit: "plays" }) },
    {
      label: "Shares: how a whole splits",
      isWide: true,
      markup: chartPane({ label: "Players by browser", unit: "players", chartKind: "shares", points: [
        { label: "Chrome", amountNumber: 6120 }, { label: "Safari", amountNumber: 3480 }, { label: "Edge", amountNumber: 1210 }, { label: "Firefox", amountNumber: 860 }, { label: "Others", amountNumber: 330 },
      ] }),
    },
    {
      label: "Shares in its game's tint: in shades of it",
      isWide: true,
      markup: chartPane({ tintColor: "#9B4DFF", label: "Players by device", unit: "players", chartKind: "shares", points: [
        { label: "Computer", amountNumber: 7240 }, { label: "Phone", amountNumber: 3910 }, { label: "Tablet", amountNumber: 850 },
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
  /** What used it: a row under the track for each part, biggest first, its groove lit as far as its share of the use. */
  parts?: UsagePart[];
  /** Its track and its parts' rows alone, with no label or numbers: for a list row, or an old page's own plate, whose own lines say them. */
  isTrackOnly?: boolean;
}

/** One part of what used a meter: its name and its share of the use in whole percent. */
export interface UsagePart {
  label: string;
  sharePct: number;
}

/** How full a meter is, and its tone: red from its warning point, striped when all used. */
function meterState(options: UsageMeterOptions) {
  const sharePct = Math.min(100, (options.usedNumber / Math.max(options.limitNumber, 1)) * 100);
  const isAllUsed = options.usedNumber >= options.limitNumber && !options.isFullFine;
  const warnFromPct = options.warnFromNumber === undefined ? 80 : (options.warnFromNumber / Math.max(options.limitNumber, 1)) * 100;
  const tone = isAllUsed ? " is-full" : sharePct >= warnFromPct ? " is-near" : options.usedNumber > 0 ? " is-used" : "";
  return { sharePct, isAllUsed, tone };
}


function usedParts(options: UsageMeterOptions): UsagePart[] {
  return (options.parts?.filter((part) => part.sharePct > 0) ?? []).sort((one, other) => other.sharePct - one.sharePct);
}

function meterTrack(options: UsageMeterOptions, sharePct: number): Raw {
  return html`<div class="usage-track" role="meter" aria-label="${options.label}" aria-valuemin="0" aria-valuemax="${options.limitNumber}" aria-valuenow="${Math.min(options.usedNumber, options.limitNumber)}">${groove({ kind: "usage-groove", filledPct: sharePct })}</div>`;
}

/** Under a meter with parts: Chart's share rows, quiet, biggest first, each part's name and share over a hairline groove in the meter's light. */
function usageKey(options: UsageMeterOptions): Raw | "" {
  const parts = usedParts(options);
  return parts.length ? shareRows(parts, `What used ${options.label}`, true) : "";
}

/**
 * A usage meter: its label, its numbers under it, then a Groove filling in its orange light, red from 80%. Any use at all shows as a
 * sliver, never as an empty track. All used, it's unmistakable: the fill is striped red across the whole track, a warning mark leads its
 * label, and its numbers end in "all used", or in how far over it is.
 */
export function usageMeter(options: UsageMeterOptions): Raw {
  const { sharePct, isAllUsed, tone } = meterState(options);
  if (options.isTrackOnly) return html`<span class="usage${tone}">${meterTrack(options, sharePct)}${usageKey(options)}</span>`;
  const overNumber = options.usedNumber - options.limitNumber;
  const allUsedWords = overNumber > 0 ? `, ${chartWords(overNumber)} ${options.unit} over` : ", all used";
  const resetWords = options.resetDate ? `Resets ${new Date(`${options.resetDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.` : "";
  return html`<div class="usage${tone}"><span class="usage-label words-margin">${isAllUsed ? icon("warning") : ""}${options.label}</span><p class="usage-numbers words-margin"><span class="usage-fact">${options.shownWords ?? html`${chartWords(options.usedNumber)} of ${chartWords(options.limitNumber)}\u00a0${options.unit}`}${isAllUsed ? html`<b>${allUsedWords}</b>` : ""}${resetWords ? "\u00a0·" : ""}</span>${resetWords ? html` <span class="usage-fact">${resetWords}</span>` : ""}</p>${meterTrack(options, sharePct)}${usageKey(options)}</div>`;
}

const meterPane = (options: UsageMeterOptions) => glassPane({ paneWidth: "fit", body: stackOfOne(usageMeter(options)) });

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
/* The track is the meter: thick, so the total leads whatever's under it. */
.usage-track { display: block; }
.usage-groove.carving.deep.line { height: 16px; }
.usage > .share-rows { margin-top: var(--gap-words-control); }
.usage-groove .groove-fill { transition: width var(--motion-settle) var(--spring); }
/* Any use at all shows: a sliver long enough to show past a cut corner's line at its start. */
.usage:is(.is-used, .is-near) .usage-groove .groove-fill { min-width: 14px; }
.usage:is(.is-near, .is-full) .usage-groove .groove-fill { filter: drop-shadow(0 0 1.5px var(--meter-near)); }
.usage.is-near .usage-groove .groove-light { background: linear-gradient(180deg, var(--meter-near-hi), var(--meter-near)); }
.usage.is-full .usage-groove .groove-light { background: repeating-linear-gradient(-45deg, var(--meter-near) 0 6px, var(--meter-full) 6px 12px); }
/* With parts, Chart's share rows under the track say what used it, each part's groove in the meter's orange light: the track says how near
   the limit it is, the rows only how the use splits. */
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
    { label: "Split by what used it: quiet rows under the thick track, biggest first, a hairline groove each lit as far as its share", markup: meterPane({ label: "Starfall", usedNumber: 62, limitNumber: 100, unit: "%", resetDate: "2026-11-01", shownWords: "62% of this month's free hosting", parts: [{ label: "Rooms", sharePct: 48 }, { label: "Game server", sharePct: 27 }, { label: "Database", sharePct: 15 }, { label: "Requests", sharePct: 10 }] }) },
    { label: "Split, past 80%", markup: meterPane({ label: "Kestrel", usedNumber: 86, limitNumber: 100, unit: "%", resetDate: "2026-11-01", shownWords: "86% of this month's free hosting", parts: [{ label: "Relay", sharePct: 75 }, { label: "Rooms", sharePct: 25 }] }) },
    { label: "Split, all used", markup: meterPane({ label: "Ashen Crown", usedNumber: 100, limitNumber: 100, unit: "%", resetDate: "2026-11-01", shownWords: "100% of this month's free hosting", parts: [{ label: "Rooms", sharePct: 100 }] }) },
    {
      label: "Its track alone (isTrackOnly), split, in a list row whose own lines say the numbers",
      markup: glassPane({
        paneWidth: "fit",
        body: stackOfOne(listRows({
          whenEmpty: NO_EMPTY_NOTE,
          rows: [{ title: "Starfall", detail: "62% of this month's free hosting · Resets Nov 1", meter: { label: "Starfall", usedNumber: 62, limitNumber: 100, unit: "%", parts: [{ label: "Rooms", sharePct: 48 }, { label: "Game server", sharePct: 27 }, { label: "Database", sharePct: 15 }, { label: "Requests", sharePct: 10 }] } }],
        })),
      }),
    },
  ],
});
