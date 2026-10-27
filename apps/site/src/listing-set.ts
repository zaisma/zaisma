import { IMAGE_KINDS, REVIEW_CODES, type ImageKind } from "@zaisma/core";
import { judgeListing, listingOutcomes, type ListingBrief, type ListingJudge, type ListingPicture, type PictureOutcome, type WordsOutcome } from "./listing-judge.ts";

/**
 * The listing check's own cases in the review test set (review-set/README.md, "The listing check's cases"): covers,
 * screenshots and titles with the outcome each must get, honest and slop. scripts/review-set/listing.mjs runs them;
 * a change to the check's prompt or model waits until every case gets its outcome on every run. Plain code with no
 * storage, bundled for Node by the runner.
 */

const MEDIA_TYPES: Record<string, ListingPicture["mediaType"]> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
/** What an item can come out as: fine, a person looks, or the code of the line it broke. */
const LISTING_CODES = ["extra_text_on_cover", "overlay_on_cover", "famous_name", "cover_not_from_game", "tag_in_title", "fake_reward", "screenshot_not_from_game", "text_on_background", "overlay_on_background", "famous_name_on_background"] as const;
export type ListingItemOutcome = "fine" | "person" | (typeof LISTING_CODES)[number];

/** One case: its case.json and its pictures. The title is the item "title"; each picture is its path. */
export interface ListingCase {
  name: string;
  title: string;
  description: string;
  pictures: { path: string; kind: ImageKind }[];
  is_honest: boolean;
  expected: Record<string, ListingItemOutcome>;
  why: string;
  files: { path: string; bytes: Uint8Array }[];
}

export interface ListingCaseRun {
  items: Record<string, ListingItemOutcome>;
  declined_attempt_count: number;
  cost_cents: number;
}

export type ListingCaseOutcome = "matched" | "missed" | "inconsistent";

export interface ListingCaseResult {
  name: string;
  is_honest: boolean;
  expected: Record<string, ListingItemOutcome>;
  runs: Record<string, ListingItemOutcome>[];
  outcome: ListingCaseOutcome;
  declined_attempt_count: number;
  cost_cents: number;
}

export interface ListingRunSummary {
  case_count: number;
  honest_case_count: number;
  slop_case_count: number;
  matched_case_count: number;
  missed_case_count: number;
  inconsistent_case_count: number;
  declined_attempt_count: number;
  cost_cents: number;
  is_passing: boolean;
}

const CASE_KEYS = ["title", "description", "pictures", "is_honest", "expected", "why"];
const isItemOutcome = (candidate: unknown): candidate is ListingItemOutcome => candidate === "fine" || candidate === "person" || (LISTING_CODES as readonly unknown[]).includes(candidate);

/** The problems with a listing case's case.json, each one plain sentence; empty when it's fine. */
export function checkListingCase(caseFile: unknown, filePaths: string[]): string[] {
  if (typeof caseFile !== "object" || caseFile === null || Array.isArray(caseFile)) return ["case.json isn't a JSON object."];
  const fields = caseFile as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(fields)) if (!CASE_KEYS.includes(key)) problems.push(`Unknown key "${key}": the keys are ${CASE_KEYS.join(", ")}.`);
  for (const key of CASE_KEYS) if (!(key in fields)) problems.push(`Missing "${key}".`);
  if (typeof fields.title !== "string" || !fields.title.trim()) problems.push('"title" must be a non-empty string.');
  if (typeof fields.description !== "string") problems.push('"description" must be a string.');
  if (typeof fields.why !== "string" || !fields.why.trim()) problems.push('"why" must be a non-empty string: where the line is, and which side of it each picture is on.');
  if (typeof fields.is_honest !== "boolean") problems.push('"is_honest" must be true or false.');
  const pictures = Array.isArray(fields.pictures) ? (fields.pictures as { path?: unknown; kind?: unknown }[]) : null;
  if (!pictures) problems.push('"pictures" must be a list of { "path", "kind" }.');
  for (const picture of pictures ?? []) {
    if (typeof picture.path !== "string" || !filePaths.includes(picture.path)) problems.push(`The picture ${JSON.stringify(picture.path)} isn't a file in the case's folder.`);
    else if (!MEDIA_TYPES[picture.path.split(".").pop()!.toLowerCase()]) problems.push(`${picture.path} isn't a PNG, JPEG or WebP file.`);
    if (!IMAGE_KINDS.includes(picture.kind as ImageKind)) problems.push(`${String(picture.path)}'s "kind" must be one of ${IMAGE_KINDS.join(", ")}.`);
  }
  const expected = typeof fields.expected === "object" && fields.expected !== null && !Array.isArray(fields.expected) ? (fields.expected as Record<string, unknown>) : null;
  if (!expected) problems.push('"expected" must be an object: each picture\'s path, and "title", with the outcome it must get.');
  else {
    const items = ["title", ...(pictures ?? []).map((picture) => String(picture.path))];
    for (const itemName of items) if (!(itemName in expected)) problems.push(`"expected" has nothing for ${itemName}.`);
    for (const [itemName, outcome] of Object.entries(expected)) {
      if (!items.includes(itemName)) problems.push(`"expected" names ${itemName}, which isn't "title" or one of the pictures.`);
      if (!isItemOutcome(outcome)) problems.push(`${itemName}'s outcome must be fine, person or one of ${LISTING_CODES.join(", ")}.`);
    }
    if (fields.is_honest === true && Object.values(expected).some((outcome) => outcome !== "fine")) problems.push('An honest case expects "fine" for everything.');
    if (fields.is_honest === false && Object.values(expected).every((outcome) => outcome === "fine")) problems.push("A slop case expects at least one line broken.");
  }
  return problems;
}

const itemOutcome = (outcome: PictureOutcome | WordsOutcome | undefined): ListingItemOutcome => (!outcome || outcome.outcome === "person" ? "person" : outcome.outcome === "fine" ? "fine" : (outcome.reason.code as ListingItemOutcome));

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/** The check on one case, as runListingCheck sends it: every picture judged, with the title and description. */
export async function runListingCase(env: { ANTHROPIC_API_KEY: string; LISTING_CHECK_MODEL: string }, listingCase: ListingCase, judge: ListingJudge = judgeListing): Promise<ListingCaseRun> {
  const bytesOf = (path: string) => listingCase.files.find((file) => file.path === path)!.bytes;
  // Covers first, then screenshots, as the check orders them.
  const ordered = [...listingCase.pictures].sort((first, second) => Number(first.kind === "screenshot") - Number(second.kind === "screenshot"));
  const brief: ListingBrief = {
    title: listingCase.title,
    isTitleJudged: true,
    description: listingCase.description,
    isDescriptionJudged: true,
    pictures: ordered.map((picture) => ({ id: picture.path, kind: picture.kind, mediaType: MEDIA_TYPES[picture.path.split(".").pop()!.toLowerCase()]!, base64: toBase64(bytesOf(picture.path)), isJudged: true })),
  };
  const judged = await judge(env.ANTHROPIC_API_KEY, env.LISTING_CHECK_MODEL, brief);
  const outcomes = listingOutcomes(brief, judged.answer);
  const items: Record<string, ListingItemOutcome> = { title: itemOutcome(outcomes.title) };
  for (const picture of listingCase.pictures) items[picture.path] = itemOutcome(outcomes.pictures[picture.path]);
  return { items, declined_attempt_count: judged.declinedAttemptCount, cost_cents: judged.costCents };
}

const sameItems = (first: Record<string, ListingItemOutcome>, second: Record<string, ListingItemOutcome>) => Object.keys(first).length === Object.keys(second).length && Object.entries(first).every(([itemName, outcome]) => second[itemName] === outcome);

/** A case after all its runs: matched when every run gets the expected outcome for every item. */
export function listingCaseResult(listingCase: ListingCase, runs: ListingCaseRun[]): ListingCaseResult {
  const items = runs.map((run) => run.items);
  const outcome: ListingCaseOutcome = items.length && items.every((run) => sameItems(run, listingCase.expected)) ? "matched" : items.every((run) => sameItems(run, items[0]!)) ? "missed" : "inconsistent";
  return {
    name: listingCase.name,
    is_honest: listingCase.is_honest,
    expected: listingCase.expected,
    runs: items,
    outcome,
    declined_attempt_count: runs.reduce((attemptCount, run) => attemptCount + run.declined_attempt_count, 0),
    cost_cents: runs.reduce((costCents, run) => costCents + run.cost_cents, 0),
  };
}

export function summarizeListingRun(results: ListingCaseResult[]): ListingRunSummary {
  const caseCountOf = (outcome: ListingCaseOutcome) => results.filter((caseResult) => caseResult.outcome === outcome).length;
  return {
    case_count: results.length,
    honest_case_count: results.filter((caseResult) => caseResult.is_honest).length,
    slop_case_count: results.filter((caseResult) => !caseResult.is_honest).length,
    matched_case_count: caseCountOf("matched"),
    missed_case_count: caseCountOf("missed"),
    inconsistent_case_count: caseCountOf("inconsistent"),
    declined_attempt_count: results.reduce((attemptCount, caseResult) => attemptCount + caseResult.declined_attempt_count, 0),
    cost_cents: results.reduce((costCents, caseResult) => costCents + caseResult.cost_cents, 0),
    is_passing: results.length > 0 && caseCountOf("matched") === results.length,
  };
}

/** Every listing code is a review code, so a case can't expect one the check doesn't give. */
export const LISTING_ITEM_CODES: readonly string[] = LISTING_CODES.filter((code) => code in REVIEW_CODES);
