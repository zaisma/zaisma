import { html, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import type { ControlMarkup } from "./control-markup.ts";
import { secondaryButton, textLink } from "./actions.ts";
import { glassPane, tag, type ShownPicture } from "./foundations.ts";
import { details, pictureFrame, type Detail } from "./data.ts";
import { STAND_IN_ACCOUNT_PICTURES } from "../generated/stand-in-placeholders.generated.ts";
import { row, stackOfOne } from "./layout.ts";

/*
 * People: someone on Zaisma named on a page (a friend in a list, a game's developer, a post's author). Pages
 * still to build lean on them: Friends, profiles, the forum, a game's page and its updates.
 */

export interface PersonOptions {
  username: string;
  /** Their profile: their name goes there. */
  href: string;
  /** A line about them under their name: "Playing Ashen Crown", "12 games on Zaisma", "Friends since March". */
  note?: string;
  /** Their picture's size: small in a list ("sm"), regular beside a heading or on its own ("md"), large at the head of their profile ("lg"). */
  pictureSize?: "sm" | "md" | "lg";
  /** What they're doing now, in green under their name, before their line: "Online", "Playing Ashen Crown". Only where the viewer may see it. */
  activity?: string;
  /** The picture they gave; left out, their initials. */
  picture?: ShownPicture;
  /** Marks beside their name: Tags (Developer, Blocked). */
  marks?: Raw;
  /** One control at the row's end: Join, Add a friend, or a menu's button. */
  end?: ControlMarkup;
  /** At the head of their profile, a few details about them across under their line (Friends since, Games): Details, side by side. */
  details?: Detail[];
}

/**
 * A person: their picture in its frame, their name a quiet Link to their profile with any marks beside it, a line about them under it, and
 * at most one control at the row's end. A long username wraps rather than being cut.
 */
export function person(options: PersonOptions): Raw {
  const pictureSize = options.pictureSize ?? "md";
  return html`<div class="person ${pictureSize}">${pictureFrame(options.username, pictureSize, { picture: options.picture })}<span class="person-words"><span class="person-name">${textLink(options.username, options.href, { isQuiet: true })}${options.marks ?? ""}</span>${options.activity ? html`<span class="person-activity">${options.activity}</span>` : ""}${options.note ? html`<span class="person-note">${options.note}</span>` : ""}${options.details?.length ? html`<span class="person-details">${details({ arrangement: "across", details: options.details })}</span>` : ""}</span>${options.end ? html`<span class="person-end">${options.end}</span>` : ""}</div>`;
}

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
/* A profile's head: the large picture beside a larger name, its line, and its details across under them. */
.person.lg { gap: var(--gap-block-block); }
.person.lg .person-name { font: var(--type-section); }
.person-details { display: grid; margin-top: var(--gap-words-control); }
.person-note { font: var(--type-facts); color: var(--muted); }
.person-activity { font: var(--type-facts); color: var(--tag-new-ink); }
.person-end { flex: none; display: flex; margin-inline-start: auto; }
`,
  render: person,
  examples: [
    { label: "A game's developer", markup: glassPane({ paneWidth: "fit", body: stackOfOne(person({ username: "lumen_works", href: "#person", note: "12 games on Zaisma" }), "words") }) },
    { label: "A friend in a room, with Join", markup: glassPane({ paneWidth: "fit", body: stackOfOne(person({ username: "Liam", href: "#person", pictureSize: "sm", activity: "Playing Ashen Crown", end: secondaryButton("Join", { type: "button", isSmall: true }) }), "words") }) },
    { label: "A profile's head: large, with details about them", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(person({ username: "Sofia", href: "#person", pictureSize: "lg", picture: STAND_IN_ACCOUNT_PICTURES["kestrel-sky"], activity: "Playing Ashen Crown", details: [{ label: "Friends since", text: "March" }, { label: "Games", text: "12" }, { label: "On Zaisma since", text: "2026" }], end: secondaryButton("Add a friend", { type: "button" }) }), "words") }) },
    { label: "A long username, with a mark", markup: glassPane({ paneWidth: "fit", body: stackOfOne(person({ username: "the_longest_username_allowed", href: "#person", note: "Played 2,140 hours", marks: tag("Developer", "plain") }), "words") }) },
  ],
});
