import { html, layout, type Raw } from "../../../apps/site/src/html.ts";
import type { Env } from "../../../apps/site/src/env.ts";
import { secondaryButton } from "../../../apps/site/src/components/actions.ts";
import { glassPane, picture } from "../../../apps/site/src/components/foundations.ts";
import { stateNote, table } from "../../../apps/site/src/components/data.ts";
import { row, stack, type LayoutItem } from "../../../apps/site/src/components/layout.ts";

/*
 * The stamp view: every finished page waiting for a stamp, on the local preview's Screens bench (/design/screens?view=stamp). Each page
 * shows on a phone and a laptop, light over dark (the layout check's contact sheet), next to its concept picture, with what the
 * art-director reviewer found and what became of it. "Open it live" opens it on its own session's preview, on that preview's bench, where
 * a press goes through it and the Feedback button takes a flag to that session. The stamp itself is pressed on the board, not here.
 * The entries are scripts/preview/stamp-queue.mjs's; the feedback server answers them with each picture's size (bench-files.mjs).
 */

interface StampPicture { url: string; width_px: number; height_px: number }
interface StampPage { page_label: string; path: string; place_value?: string | null; state_value?: string | null; profile?: string | null; sheet: StampPicture | null }
interface StampFinding { piece?: string; screen?: string; state?: string; finding: string; rule?: string; outcome: "fixed" | "answered" | "open"; answer?: string }
export interface StampEntry { pull_request_number: number; head_sha: string; change_title: string; session_name: string; preview_sites: string[]; waiting_since_at: string; pages: StampPage[]; concept: StampPicture | null; findings: StampFinding[] }

const OUTCOME_WORDS = { fixed: "Fixed", answered: "Answered", open: "Open" } as const;

/** The waiting session's preview at the address this page was opened on: its tailnet name from a phone, localhost on the Mac. */
export function siteFor(entry: StampEntry, viewer: URL): string {
  return entry.preview_sites.find((site) => new URL(site).hostname === viewer.hostname) ?? entry.preview_sites[0]!;
}

/** The page live on its own preview's bench, on its place, state and profile, or by its address. */
export function liveBenchUrl(entry: StampEntry, page: StampPage, viewer: URL): string {
  const url = new URL("/design/screens", siteFor(entry, viewer));
  if (page.place_value) {
    url.searchParams.set("place", page.place_value);
    if (page.state_value) url.searchParams.set("state", page.state_value);
    if (page.profile) url.searchParams.set("profile", page.profile);
  } else url.searchParams.set("page", page.path);
  return url.href;
}

const shown = (picture: StampPicture) => ({ imageUrl: picture.url, widthPx: picture.width_px, heightPx: picture.height_px, placeholderDataUrl: null });

function pageItems(entry: StampEntry, page: StampPage, viewer: URL): LayoutItem[] {
  const pictures: LayoutItem[] = [
    ...(page.sheet ? [{ kind: "block" as const, markup: picture(shown(page.sheet), { label: `${page.page_label} on a phone and a laptop, light over dark`, isEager: true, shownSizes: "60vw" }) }] : [{ kind: "words" as const, markup: html`<p>No contact sheet.</p>` }]),
    ...(entry.concept ? [{ kind: "block" as const, markup: picture(shown(entry.concept), { label: "Its concept", isEager: true, shownSizes: "25vw" }) }] : []),
  ];
  return [
    { kind: "words", markup: html`<h3>${page.page_label}</h3>` },
    { kind: "block", markup: row({ widths: "lead-fills", items: pictures }) },
    { kind: "control", markup: secondaryButton("Open it live", { href: liveBenchUrl(entry, page, viewer), isSmall: true }) },
  ];
}

function entryPane(entry: StampEntry, viewer: URL): Raw {
  const openCount = entry.findings.filter((finding) => finding.outcome === "open").length;
  const findings = entry.findings.length
    ? table({ caption: `What the reviewer found${openCount ? `: ${openCount} open` : ""}`, isCompact: true, columns: [{ label: "Piece" }, { label: "Screen" }, { label: "State" }, { label: "Finding", isLongText: true }, { label: "Rule", isLongText: true }, { label: "Outcome" }, { label: "Answer", isLongText: true }], whenEmpty: stateNote({ stateKind: "empty", title: "Nothing found", text: "The reviewer found nothing on this page." }), rows: entry.findings.map((finding) => [finding.piece ?? "", finding.screen ?? "", finding.state ?? "", finding.finding, finding.rule ?? "", OUTCOME_WORDS[finding.outcome], finding.answer ?? ""]) })
    : html`<p>The reviewer found nothing.</p>`;
  return glassPane({ paneWidth: "full", label: entry.change_title, body: stack({ items: [
    { kind: "words", markup: html`<h2>${entry.change_title}</h2>` },
    { kind: "words", markup: html`<p>Pull request ${String(entry.pull_request_number)}, from ${entry.session_name}, waiting since ${entry.waiting_since_at.slice(0, 16).replace("T", " ")} UTC, at commit ${entry.head_sha.slice(0, 7)}.</p>` },
    ...entry.pages.flatMap((page) => pageItems(entry, page, viewer)),
    { kind: "block", markup: findings },
  ] }) });
}

/** GET /design/screens?view=stamp: the pages waiting for a stamp. */
export function stampPage(env: Env, url: URL, entries: StampEntry[]): Response {
  const head = glassPane({ paneWidth: "full", label: "Waiting for a stamp", body: stack({ items: [
    { kind: "words", markup: html`<h1>Waiting for a stamp</h1>` },
    ...(entries.length ? [{ kind: "words" as const, markup: html`<p>${entries.length === 1 ? "One page" : `${String(entries.length)} pages`} passed the motion sheet and the reviewer. Stamp each on the board, at your Mac. Open one live to press through it and leave feedback there.</p>` }] : []),
    { kind: "control", markup: secondaryButton("Screens", { href: "/design/screens", isSmall: true }) },
  ] }) });
  const body = entries.length
    ? html`${stack({ items: [{ kind: "block", markup: head }, ...entries.map((entry) => ({ kind: "block" as const, markup: entryPane(entry, url) }))] })}`
    : html`${stack({ items: [{ kind: "block", markup: head }, { kind: "block", markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "block", markup: stateNote({ stateKind: "empty", title: "Nothing waiting", text: "A page shows here once its session has passed the motion sheet and the reviewer and added it to the stamp queue." }) }] }) }) }] })}`;
  return layout(env, { title: "Stamps · Screens · Design · Zaisma", body, checkedPage: "Screens", pageShape: "wide", isPrivate: true });
}
