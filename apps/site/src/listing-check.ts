import {
  addReviewUsage,
  aiUsage,
  audit,
  cardImageKey,
  gameById,
  imageKey,
  imagesForGame,
  readReviewReason,
  requestListingCheck,
  setReviewStatus,
  settleDetailsWaitingForReview,
  settleImage,
  type Game,
  type GameImage,
  type ReviewReason,
} from "@zaisma/core";
import type { Env } from "./env.ts";
import { sendAlert } from "./email.ts";
import { judgeListing, listingOutcomes, type ListingBrief, type ListingJudge, type ListingPicture } from "./listing-judge.ts";
import { tellWebhooks } from "./webhooks.ts";

const now = () => Date.now();

/**
 * The listing check ("No slop" in docs/DECISIONS.md): about a minute after a game's covers, screenshots or
 * words change, an AI looks at them together (listing-judge.ts) in place of a person. A fine picture is
 * approved; one that breaks a listing line is approved with its listing_reason, which keeps the game off
 * Zaisma's lists (SHOWN_IN_LISTS_SQL); a screenshot with something added after capture is rejected; a fake
 * reward holds the game for a person. Anything about safety, and everything when the AI can't answer, waits
 * for a person as before. A picture or title a person cleared is left alone.
 */

export const LISTING_CHECK_LIMITS = {
  /** Seconds between a change and its check, so a burst of uploads is checked once. */
  delaySec: 30,
  /** A check asked for longer ago than this, and not run, is queued again by the cron. */
  staleRequestMs: 10 * 60_000,
  /** Games the cron queues in one run. */
  maximumQueuedGameCount: 50,
  /** The pictures' bytes one check sends, so the request stays under the API's size limit. */
  maximumSentSizeBytes: 15 * 1024 * 1024,
  /** The API takes pictures up to this many pixels on a side; bigger ones wait for a person. */
  maximumSidePx: 8000,
};

/** Ask for the check on a game and queue it; the cron catches any queue message that's lost. */
export async function queueListingCheck(env: Env, gameId: string): Promise<void> {
  await requestListingCheck(env.DB, gameId);
  await env.SCAN_QUEUE.send({ listingCheckGameId: gameId }, { delaySeconds: LISTING_CHECK_LIMITS.delaySec });
}

/** Whether the check can run now: a key, and the review's monthly budget not used up. */
async function canCheck(env: Env): Promise<boolean> {
  if (!env.ANTHROPIC_API_KEY) return false;
  return (await aiUsage(env.DB)).review_cost_cents < (Number(env.AI_REVIEW_MONTHLY_BUDGET_CENTS) || 0);
}

/** Every 5 minutes: games whose check was asked for over 10 minutes ago and hasn't run (a lost message, or the migration's first pass). */
export async function queueListingChecks(env: Env, nowMs = Date.now()): Promise<number> {
  if (!(await canCheck(env))) return 0;
  const { results } = await env.DB.prepare(
    `SELECT id FROM games WHERE listing_check_requested_at_ms IS NOT NULL AND listing_check_requested_at_ms < ? AND (listing_checked_at_ms IS NULL OR listing_checked_at_ms < listing_check_requested_at_ms) AND review_status != 'removed'
     ORDER BY listing_check_requested_at_ms LIMIT ?`,
  )
    .bind(nowMs - LISTING_CHECK_LIMITS.staleRequestMs, LISTING_CHECK_LIMITS.maximumQueuedGameCount)
    .all<{ id: string }>();
  if (results.length) await env.SCAN_QUEUE.sendBatch(results.map((game) => ({ body: { listingCheckGameId: game.id } })));
  return results.length;
}

const isFakeReward = (stored: string | null) => readReviewReason(stored)?.code === "fake_reward";

/** Run the check on a game, when something changed since it last ran. */
export async function runListingCheck(env: Env, gameId: string, judge: ListingJudge = judgeListing): Promise<void> {
  const startedAtMs = now();
  const game = await gameById(env.DB, gameId);
  if (!game || game.review_status === "removed") return;
  if (game.listing_checked_at_ms !== null && game.listing_check_requested_at_ms !== null && game.listing_checked_at_ms > game.listing_check_requested_at_ms) return;
  if (!(await canCheck(env))) return;

  const images = (await imagesForGame(env.DB, game.id)).filter((image) => image.review_status !== "rejected");
  const waiting = game.details_waiting_for_review ? (JSON.parse(game.details_waiting_for_review) as { title?: string; description?: string }) : null;
  const title = waiting?.title ?? game.title;
  const description = waiting?.description ?? game.description;
  const { brief, sentImages } = await listingBrief(env, game, images, title, description);
  const judged = await judge(env.ANTHROPIC_API_KEY!, env.LISTING_CHECK_MODEL, brief);
  if (judged.costCents > 0) await addReviewUsage(env.DB, judged.costCents);
  const outcomes = listingOutcomes(brief, judged.answer);

  // Pictures.
  const replaced: GameImage[] = [];
  for (const image of sentImages) {
    const outcome = outcomes.pictures[image.id];
    if (!outcome || outcome.outcome === "person") continue;
    if (outcome.outcome === "rejected") {
      await settleImage(env.DB, image, outcome.reason, "check");
    } else if (outcome.outcome === "held") {
      await setListingReason(env, image.id, outcome.reason);
    } else {
      const listingReason = outcome.outcome === "off_lists" ? outcome.reason : null;
      if (image.review_status === "pending") replaced.push(...(await settleImage(env.DB, image, null, "check", listingReason)));
      else await setListingReason(env, image.id, listingReason);
    }
  }
  if (replaced.length) await env.GAMES.delete(replaced.flatMap((old) => [imageKey(old), cardImageKey(old)]));

  // Words: new words on a shown game are applied once nothing about them needs a person.
  if (waiting && outcomes.isWordsClear) {
    await settleDetailsWaitingForReview(env.DB, game, true);
    await audit(env.DB, game.id, "details-approved", "By the listing check", "listing check");
  }
  const areWordsApplied = !waiting || outcomes.isWordsClear;
  if (brief.isTitleJudged && areWordsApplied && outcomes.title.outcome !== "person") {
    const titleReason = outcomes.title.outcome === "fine" ? null : outcomes.title.reason;
    await env.DB.prepare("UPDATE games SET title_listing_reason = ? WHERE id = ?").bind(titleReason ? JSON.stringify(titleReason) : null, game.id).run();
  }

  // A fake reward holds the game for a person.
  if (outcomes.heldReason && game.review_status !== "held") await holdForFakeReward(env, game, outcomes.heldReason);

  const summary = Object.entries(outcomes.pictures)
    .map(([id, outcome]) => `${id} ${outcome.outcome}${"reason" in outcome ? ` (${outcome.reason.code})` : ""}`)
    .concat(brief.isTitleJudged ? [`title ${outcomes.title.outcome}${"reason" in outcomes.title ? ` (${outcomes.title.reason.code})` : ""}`] : []);
  await audit(env.DB, game.id, "listing-check", judged.answer ? summary.join(", ") || "Nothing to judge" : "The AI couldn't answer; a person looks", "listing check");
  await env.DB.prepare("UPDATE games SET listing_checked_at_ms = ? WHERE id = ?").bind(startedAtMs, game.id).run();
}

async function setListingReason(env: Env, imageId: string, listingReason: ReviewReason | null): Promise<void> {
  await env.DB.prepare("UPDATE game_images SET listing_reason = ? WHERE id = ?").bind(listingReason ? JSON.stringify(listingReason) : null, imageId).run();
}

/**
 * What the check sends: covers first, then screenshots, newest first within a kind, until the size cap. A picture a
 * person cleared goes as a reference only (a screenshot to compare covers with) or not at all (a cover).
 */
async function listingBrief(env: Env, game: Game, images: GameImage[], title: string, description: string): Promise<{ brief: ListingBrief; sentImages: GameImage[] }> {
  const order = (image: GameImage) => (image.kind === "screenshot" ? 1 : 0);
  const candidates = images
    .filter((image) => image.kind === "screenshot" || image.cleared_at_ms === null)
    .filter((image) => Math.max(image.width_px, image.height_px) <= LISTING_CHECK_LIMITS.maximumSidePx)
    .sort((first, second) => order(first) - order(second) || (first.review_status === "pending" ? -1 : 0) - (second.review_status === "pending" ? -1 : 0) || second.created_at_ms - first.created_at_ms);
  const pictures: ListingPicture[] = [];
  const sentImages: GameImage[] = [];
  let sentSizeBytes = 0;
  for (const image of candidates) {
    if (sentSizeBytes + image.size_bytes > LISTING_CHECK_LIMITS.maximumSentSizeBytes) continue;
    const object = await env.GAMES.get(imageKey(image));
    if (!object) continue;
    sentSizeBytes += image.size_bytes;
    const isJudged = image.cleared_at_ms === null;
    pictures.push({ id: image.id, kind: image.kind, mediaType: image.content_type as ListingPicture["mediaType"], base64: toBase64(new Uint8Array(await object.arrayBuffer())), isJudged });
    if (isJudged) sentImages.push(image);
  }
  return {
    brief: { title, isTitleJudged: title !== game.cleared_title, description, isDescriptionJudged: true, pictures },
    sentImages,
  };
}

async function holdForFakeReward(env: Env, game: Game, heldReason: ReviewReason): Promise<void> {
  await setReviewStatus(env.DB, game.id, "held", heldReason);
  await audit(env.DB, game.id, "held", heldReason.message, "listing check", heldReason);
  await tellWebhooks(env, "review_status_changed", game.id, {});
  await sendAlert(env, `Held for a fake reward: ${game.slug}`, `The listing check found a fake reward and held the game until a person looks.\n\n${heldReason.message}\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`);
}

/**
 * A person restored a game the check held for a fake reward: the pictures and title behind the hold are cleared,
 * so the check doesn't hold it again for the same thing. Pending pictures are approved, as a person's approval would.
 */
export async function clearFakeRewardItems(env: Env, game: Game): Promise<void> {
  const images = await imagesForGame(env.DB, game.id);
  for (const image of images.filter((candidate) => candidate.review_status !== "rejected" && isFakeReward(candidate.listing_reason))) {
    const replaced = await settleImage(env.DB, image, null, "person");
    if (replaced.length) await env.GAMES.delete(replaced.flatMap((old) => [imageKey(old), cardImageKey(old)]));
  }
  if (isFakeReward(game.title_listing_reason)) await env.DB.prepare("UPDATE games SET title_listing_reason = NULL, cleared_title = title WHERE id = ?").bind(game.id).run();
}

/** A person says a picture's listing reason is wrong: it's cleared for good. */
export async function clearImageListingReason(env: Env, image: GameImage): Promise<void> {
  await env.DB.prepare("UPDATE game_images SET listing_reason = NULL, cleared_at_ms = ? WHERE id = ?").bind(now(), image.id).run();
}

/** A person says the title's listing reason is wrong: this title is cleared for good. */
export async function clearTitleListingReason(env: Env, game: Game): Promise<void> {
  await env.DB.prepare("UPDATE games SET title_listing_reason = NULL, cleared_title = title WHERE id = ?").bind(game.id).run();
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
