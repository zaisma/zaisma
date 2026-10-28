import {
  IMAGE_TYPES,
  PLAN_LIMITS,
  REVIEW_CODES,
  REVIEW_LIMITS,
  TEXT_EXTENSIONS,
  addAiUsage,
  addReviewUsage,
  aiUsage,
  currentMonth,
  dailyReviewMeaning,
  FIXABLE_FINDING_CODES,
  isSameItem,
  isTweak,
  limitsFor,
  planFor,
  apiKeyTokensIn,
  audit,
  decide,
  extensionOf,
  gameById,
  notConnected,
  publishVersion,
  saveScan,
  setReviewStatus,
  reviewReason,
  sha256Hex,
  staticScan,
  versionById,
  type EvidenceItem,
  type Finding,
  type PlanLimits,
  type ImageMatcher,
  type ReviewAi,
  type ImageMatchResult,
  type ScanJob,
  type ScanReport,
  type Manifest,
  type Version,
  type Game,
  KEPT_VERSION_COUNT,
  LIFELIKE_GORE_MINIMUM_PLAYER_AGE_YEARS,
  KNOWN_IMAGE_CODE,
  MATCH_TYPES,
  MATROSKA_HEAD_BYTES,
  MINIMUM_PACK_PICTURE_SIZE_BYTES,
  PACK_EXTENSIONS,
  PACK_WINDOW_SIZE_BYTES,
  SNIFF_BYTES,
  approveDraft,
  arachnidShield,
  eitherMatcher,
  photoDna,
  type PhotoDnaPriority,
  type PhotoDnaService,
  embeddedMedia,
  matroskaHasVideo,
  picturesInside,
  sniffMedia,
  godotPicturesInside,
  isGodotPack,
  isUnityPack,
  unityPicturesInside,
  type ByteSource,
  type MediaForMatching,
  blobKey,
  blobSizes,
  ownedBlobKey,
  manifestKey,
  ANTIVIRUS_ANSWER_KEPT_DURATION_DAYS,
  ANTIVIRUS_UNKNOWN_FILE_KEPT_DURATION_DAYS,
  CHECKED_FILE_KEPT_DURATION_DAYS,
} from "@zaisma/core";
import { deletePrefix } from "./upload.ts";
import { chooseReadPictures, gatherEvidence, newReadCount, readCode, readPictures, type EarlierText, type PictureFile, type ReadCode, type ReadPictures, type ReaderPicture } from "./review-readers.ts";
import { judgeVersion, type EarlierHold, type JudgeVersion } from "./review-judge.ts";
import { activeReviewPrecedents, draftMiss, draftWithAi, type ReviewPrecedentDrafter } from "./review-precedents.ts";
import { findMatchedGame } from "./copies.ts";
import { tellWebhooks } from "./webhooks.ts";
import { alertIfNoticeFixPublished } from "./notices.ts";
import { updateLiveMatches } from "./match-updates.ts";
import { sendAlert } from "./email.ts";
import { queuePerformanceCheck } from "./performance-check.ts";
import type { Env } from "./env.ts";
import { recheckFailed, recheckVersion } from "./triage.ts";
import { turnOffLeakedKeys } from "./leaked-keys.ts";
import { buildHasThreads } from "../../../packages/cli/check.mjs";

/** Most text we read for the static checks. Bigger games are held for a person. */
const MAXIMUM_STATIC_TEXT_SIZE_BYTES = 40 * 1024 * 1024;
/** Most pictures and videos matched per version (each is a request to the matcher and one to storage). More are held for a person. */
export const MAXIMUM_MATCHED_MEDIA_COUNT = 5000;
/** Most other files whose first bytes are read, to find pictures and videos under other names. More are held for a person. */
export const MAXIMUM_SNIFFED_FILE_COUNT = 5000;
/** Most pictures found inside packs that are matched per version; the rest pass, with a note. */
export const MAXIMUM_PACK_PICTURE_COUNT = 10_000;

export interface ScanDeps {
  images: ImageMatcher;
  /** The AI review's readers and judge (review-readers.ts, review-judge.ts). */
  readCode: ReadCode;
  readPictures: ReadPictures;
  judge: JudgeVersion;
  /** Drafts the review precedent for a miss (review-precedents.ts); left out where nothing should call a model. */
  draft?: ReviewPrecedentDrafter;
}

/**
 * Arachnid Shield and PhotoDNA, each when its key is set, together: a match on either holds (eitherMatcher).
 * With neither, image matching isn't connected and every game waits for a person. `priority`: rechecks
 * of versions that already passed wait behind new uploads for PhotoDNA's requests.
 */
export function imageMatcher(env: Env, priority: PhotoDnaPriority = "upload"): ImageMatcher {
  const matchers: ImageMatcher[] = [];
  if (env.ARACHNID_SHIELD_KEY) matchers.push(arachnidShield(env.ARACHNID_SHIELD_KEY, { baseUrl: env.ARACHNID_SHIELD_URL }));
  if (env.PHOTODNA_KEY && env.PHOTODNA) matchers.push(photoDna(photoDnaService(env.PHOTODNA, env.PHOTODNA_KEY), { priority }));
  return matchers.length ? eitherMatcher(matchers) : notConnected;
}

/** The photodna Worker as the matcher sees it. Pictures are read whole: PhotoDNA hashes one at a time. Videos are streamed to it. */
function photoDnaService(worker: NonNullable<Env["PHOTODNA"]>, apiKey: string): PhotoDnaService {
  return {
    async hash(media) {
      const body = await media.body();
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      return worker.hash(bytes);
    },
    hashFrames: async (media) => worker.hashFrames(await media.body()),
    match: (hashes, priority) => worker.match(apiKey, hashes, priority),
  };
}

/** The providers a version still needs matching by: the connected ones its report doesn't name as finished. */
function connectedProviders(env: Env): string[] {
  return [...(env.ARACHNID_SHIELD_KEY ? ["arachnid-shield"] : []), ...(env.PHOTODNA_KEY && env.PHOTODNA ? ["photodna"] : [])];
}

export const scanDeps = (env: Env, priority: PhotoDnaPriority = "upload"): ScanDeps => ({ images: imageMatcher(env, priority), readCode, readPictures, judge: judgeVersion, draft: draftWithAi });

export async function handleScanBatch(batch: MessageBatch<ScanJob>, env: Env, injectedDeps?: ScanDeps): Promise<void> {
  const deps = injectedDeps ?? scanDeps(env);
  const recheckDeps = injectedDeps ?? scanDeps(env, "recheck");
  for (const message of batch.messages) {
    const { recheck } = message.body;
    // An image check queued before migration 0034 says `images: true`: never run it as a full scan,
    // which could publish an older approved version. Remove once no queue can still hold one.
    const isImageRecheck = message.body.isImageRecheck === true || "images" in message.body;
    try {
      if (recheck) await recheckVersion(env, message.body.versionId, recheck.reportId, deps);
      else if (isImageRecheck) await recheckImages(env, message.body.versionId, recheckDeps);
      else await scanVersion(env, message.body.versionId, deps);
      message.ack();
    } catch (error) {
      console.error(recheck ? "re-check failed" : isImageRecheck ? "image check failed" : "scan failed", message.body.versionId, error);
      if (isImageRecheck && message.attempts >= 3) {
        // Tried again with tomorrow's batch; the version stays as it is.
        message.ack();
      } else if (recheck && message.attempts >= 3) {
        await recheckFailed(env, recheck.reportId, String(error));
        message.ack();
      } else if (message.attempts >= 3) {
        await saveScan(env.DB, message.body.versionId, "held", scanFailedReport(String(error)));
        await sendAlert(env, "A scan failed", `Version ${message.body.versionId} couldn't be scanned and is held: ${String(error)}`);
        const version = await versionById(env.DB, message.body.versionId);
        if (version) await tellWebhooks(env, "scan_status_changed", version.game_id, { versionId: version.id });
        message.ack();
      } else {
        message.retry({ delaySeconds: 30 * message.attempts });
      }
    }
  }
}

export async function scanVersion(env: Env, versionId: string, deps: ScanDeps = scanDeps(env)): Promise<ScanReport> {
  const version = await versionById(env.DB, versionId);
  if (!version) throw new Error(`No version ${versionId}`);
  const game = await gameById(env.DB, version.game_id);
  if (!game) throw new Error(`No game for version ${versionId}`);

  const report = await inspectVersion(env, version, game, deps);
  const { decision, findings, is_child_safety: isChildSafety } = report;
  await saveScan(env.DB, version.id, decision, report);
  // Counts toward the owner's large and small reviews a day (steps 4e and 4a3); re-checks never get here.
  if (isJudged(report)) await env.DB.prepare("UPDATE versions SET judged_at_ms = ? WHERE id = ?").bind(report.finished_at_ms, version.id).run();
  if (report.ai && "judge_model" in report.ai && report.ai.is_small_review) await env.DB.prepare("UPDATE versions SET read_at_ms = ? WHERE id = ?").bind(report.finished_at_ms, version.id).run();
  // A version the AI judge stopped may turn out to be a miss either way: draft the rulings now, so a person's call teaches the
  // review in the same click (approving it: pass; upholding a hold: reject, so the next one like it needs no person).
  if (decision !== "approved" && deps.draft && report.ai !== null && "judge_model" in report.ai && (report.ai.verdict === "hold" || report.ai.verdict === "reject")) {
    await draftMiss(env, { versionId: version.id, decision: "pass" }, deps.draft);
    if (report.ai.verdict === "hold") await draftMiss(env, { versionId: version.id, decision: "reject" }, deps.draft);
  }
  if (decision === "approved") {
    await passVersion(env, version, "Passed the scan");
  } else {
    await audit(env.DB, game.id, decision === "held" ? "scan-held" : "scan-rejected", `${version.id}\n${summarize(findings)}`);
    const hasKnownImage = findings.some((finding) => finding.code === KNOWN_IMAGE_CODE);
    if (hasKnownImage) {
      await sendAlert(
        env,
        `URGENT: known abuse images uploaded to ${game.slug}`,
        `${KNOWN_IMAGE_ALERT}\n\n${summarize(findings)}\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`,
      );
    } else if (isChildSafety || (decision === "held" && !isOnlyWaiting(findings) && !(await isAnotherVersionWaitingForPerson(env, version)))) {
      await sendAlert(
        env,
        isChildSafety ? `URGENT child-safety flag on ${game.slug}` : `${game.slug} needs review`,
        `${isChildSafety ? "The scan flagged possible child sexual abuse material. Don't delete anything; review it and report to NCMEC if confirmed.\n\n" : ""}${summarize(findings)}\n\nReview: ${env.SITE_ORIGIN}/admin/games/${game.id}`,
      );
    }
  }
  await tellWebhooks(env, "scan_status_changed", game.id, { versionId: version.id });
  return report;
}

/** The judge ran for this report: it counts as one of the owner's judged reviews. */
const isJudged = (report: ScanReport): boolean => report.ai !== null && "judge_model" in report.ai && ["pass", "hold", "reject"].includes(report.ai.verdict);

/** Codes a version waits on with nobody to look: a free daily review (the cron scans it again), or a newer version. */
const WAITING_CODES: readonly string[] = ["daily_large_reviews_used", "daily_small_reviews_used", "version_replaced"];

/** Held only to wait for a free daily review, or replaced by a newer version: nobody needs an alert. */
const isOnlyWaiting = (findings: Finding[]): boolean => {
  const holds = findings.filter((finding) => finding.severity !== "info");
  return holds.length > 0 && holds.every((finding) => WAITING_CODES.includes(finding.code));
};

/**
 * Another version of the game already waits for a person, so its "needs review" email covered this game: one
 * email per game in the queue. A version waiting only for a daily review, or replaced by another than this one,
 * doesn't count.
 */
async function isAnotherVersionWaitingForPerson(env: Env, version: Version): Promise<boolean> {
  const { results } = await env.DB
    .prepare("SELECT scan_report FROM versions WHERE game_id = ? AND id != ? AND scan_status = 'held' AND (replaced_by_version_id IS NULL OR replaced_by_version_id = ?)")
    .bind(version.game_id, version.id, version.id)
    .all<{ scan_report: string | null }>();
  return results.some((row) => !row.scan_report || !isOnlyWaiting((JSON.parse(row.scan_report) as ScanReport).findings));
}

/** What to do when image matching finds known abuse material, for the alert and the admin page. */
export const KNOWN_IMAGE_ALERT =
  "Image matching (Arachnid Shield or PhotoDNA, named on each finding) found pictures that match known child sexual abuse material. The version is held and nothing was deleted. Don't open the pictures and don't delete anything: the law requires a report to NCMEC's CyberTipline (report.cybertip.org) as soon as possible, and the files must be kept.";

/**
 * Every check on a version's files, deciding but changing nothing: the scan saves and acts on the
 * result, and a re-check after a report (triage.ts) only compares it. `reported` is what a player
 * reported, passed to the AI reviewer as something to look into.
 */
export async function inspectVersion(env: Env, version: Version, game: Game, deps: ScanDeps = scanDeps(env), reported?: string): Promise<ScanReport> {
  // 1. Collect the files: under the version's prefix (zip uploads) or from its manifest (file-by-file uploads).
  const files = await versionFiles(env, version);
  const findings: Finding[] = [];
  const { texts, disguised, hasTooMuchCode } = await readTexts(env, files);
  if (hasTooMuchCode) findings.push({ stage: "static", severity: "hold", code: "too_much_code", message: "More code than the automatic checks read. A person should look." });

  // A Zaisma API key in a game's files is public to every player: turn it off. Info only, since the key no longer works.
  for (const { path, text } of texts) {
    const tokens = apiKeyTokensIn(text);
    if (tokens.length === 0) continue;
    const answers = await turnOffLeakedKeys(env, tokens, { foundIn: "game_files", foundAtUrl: null });
    if (answers.some((answer) => answer.isKey)) findings.push({ stage: "static", severity: "info", code: "api_key_in_files", message: "A Zaisma API key is in this file.", path });
  }

  // 2. Static checks.
  const staticResult = staticScan(texts, hostsOf(game.own_server_urls));
  findings.push(...staticResult.findings);
  if (env.VT_API_KEY) findings.push(...(await virusTotal(env, files)));

  // 2b. A re-upload of another developer's game waits for a person; the developer isn't told which game.
  const isRecheck = reported !== undefined;
  const matchedGame = isRecheck ? null : await findMatchedGame(env, game, files);
  if (matchedGame) {
    const original = await gameById(env.DB, matchedGame.gameId);
    findings.push({ stage: "static", severity: "hold", code: "matches_another_developers_game", message: `${matchedGame.matchedFileCount} of its ${matchedGame.comparedFileCount} files were sent first by another developer, in ${original?.slug ?? matchedGame.gameId}.` });
  }

  // 3. Known-illegal-image matching, before any picture is passed on.
  const imageFiles = files.filter((file) => extensionOf(file.path) in IMAGE_TYPES);
  const images = await matchMedia(env, files, texts, disguised, deps.images);
  findings.push(...images.findings);
  const hasKnownImage = images.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE);

  // 4. AI review: the checks' evidence and the readers', then one judge, within the monthly budget. Never with
  // pictures that matched known abuse material. `reviewCase` in review-set.ts mirrors steps 2 and 4b, 4c and 4f;
  // keep them in step (test/site/review-set.test.ts checks).
  const review = await reviewWithAi(env, version, game, { files, texts, staticEvidence: staticResult.evidence, imageFiles, hasStaticHold: staticResult.findings.some((finding) => finding.severity !== "info"), hasKnownImage, isRecheck, reported }, deps);
  findings.push(...review.findings);
  const isChildSafety = hasKnownImage || review.isChildSafety;

  // 5. Decide. Lifelike gore plays in games for 16 and up: the finding stays as info there.
  if (game.minimum_player_age_years >= LIFELIKE_GORE_MINIMUM_PLAYER_AGE_YEARS) {
    for (const finding of findings) if (finding.code === "ai_lifelike_gore") finding.severity = "info";
  }
  // Child-safety signals are held (never deleted) so they can be reported.
  let decision = decide(findings);
  if (isChildSafety) decision = "held";
  return {
    finished_at_ms: Date.now(),
    decision,
    findings,
    outside_hosts: staticResult.outsideHosts,
    images: { provider: images.provider, is_connected: images.isConnected, checked_media_count: images.checkedMediaCount, reused_media_count: images.reusedMediaCount },
    ai: review.ai,
    is_child_safety: isChildSafety,
    // What the check finds as needs_threads: the unpacked texts, and every file's path (a coi-serviceworker).
    has_threads: buildHasThreads([...texts.map(({ path, text }) => ({ path, contentText: text })), ...files.map(({ path }) => ({ path, contentText: null }))]),
    ...(review.evidence ? { evidence: review.evidence, read_file_sha256s: review.readFileSha256s } : {}),
    ...(matchedGame ? { matched_game: { game_id: matchedGame.gameId, matched_file_count: matchedGame.matchedFileCount, compared_file_count: matchedGame.comparedFileCount } } : {}),
  };
}

interface ReviewInput {
  files: StoredFile[];
  texts: { path: string; text: string; sha256: string }[];
  staticEvidence: EvidenceItem[];
  imageFiles: StoredFile[];
  /** A rule-based check already holds or rejects the version, so it can't be a tweak. */
  hasStaticHold: boolean;
  hasKnownImage: boolean;
  isRecheck: boolean;
  reported: string | undefined;
}

interface ReviewOutcome {
  ai: ReviewAi;
  findings: Finding[];
  isChildSafety: boolean;
  evidence?: EvidenceItem[];
  readFileSha256s?: string[];
}

/**
 * Step 4 of a scan: (a) the budget, (a2) a version a newer one replaced isn't reviewed, (a3) the owner's small
 * reviews a day, before anything is read, (b) the readers, reusing what an earlier version's readers read in
 * files that haven't changed, (c) only items whose quotes are in the files, (d) a tweak of a version that passed
 * reuses its verdict, (e) the owner's large reviews a day, (f) the judge, checking a fix against the hold it
 * answers. A re-check after a report always reads afresh with the report in mind and always runs the judge,
 * and never counts toward the day.
 */
async function reviewWithAi(env: Env, version: Version, game: Game, input: ReviewInput, deps: ScanDeps): Promise<ReviewOutcome> {
  const models = { judge_model: env.REVIEW_JUDGE_MODEL, reader_model: env.REVIEW_READER_MODEL };
  const skipped = (summary: string): ReviewAi => ({ ...models, verdict: "skipped", reused_from_version_id: null, summary, cost_cents: 0, input_token_count: 0, output_token_count: 0 });
  if (input.hasKnownImage) return { ai: skipped("Not sent for AI review: image matching found known abuse material."), findings: [], isChildSafety: false };
  if (!env.ANTHROPIC_API_KEY) {
    return { ai: skipped("No API key set."), findings: [{ stage: "ai", severity: "hold", code: "ai_review_off", message: "AI review isn't set up, so a person has to approve this game." }], isChildSafety: false };
  }
  // (a) The review's own monthly budget, in cents.
  const budgetCents = Number(env.AI_REVIEW_MONTHLY_BUDGET_CENTS) || 0;
  if ((await aiUsage(env.DB)).review_cost_cents >= budgetCents) {
    return { ai: skipped("Monthly AI review budget used up."), findings: [{ stage: "ai", severity: "hold", code: "ai_review_budget_used", message: "This month's AI review budget is used up, so a person has to approve this game." }], isChildSafety: false };
  }
  // (a2) Replaced by a newer version while it waited: its files still had every check above, but the AI skips it.
  if (!input.isRecheck && version.replaced_by_version_id) {
    return { ai: skipped("Replaced by a newer version before it was reviewed."), findings: [{ stage: "ai", severity: "hold", code: "version_replaced", message: REVIEW_CODES.version_replaced.meaning }], isChildSafety: false };
  }
  await addAiUsage(env.DB, 0, 0, "scans");

  // (a3) The owner's small reviews in the last 24 hours, counted only when the readers would read something new.
  const earlier = input.isRecheck ? null : await previousEvidence(env, version);
  const previous = earlier && { evidence: earlier.evidence, readFileSha256s: earlier.readFileSha256s, texts: await previousTexts(env, earlier.version, input.texts) };
  const pictures = await picturesToRead(env, input.imageFiles);
  const isSmallReview = !input.isRecheck && newReadCount({ texts: input.texts, pictures, previous }) > 0;
  const plan = game.owner_id ? await planFor(env.DB, game.owner_id) : "free";
  if (isSmallReview && game.owner_id && (await smallReviewCount(env, game.owner_id)) >= PLAN_LIMITS[plan].maximumSmallReviewsPerDay) {
    return { ai: skipped("Waiting for one of the developer's daily small reviews."), findings: [{ stage: "ai", severity: "hold", code: "daily_small_reviews_used", message: dailyReviewMeaning("daily_small_reviews_used", plan) }], isChildSafety: false };
  }

  // (b) Read, and (c) keep only items whose quotes are in the files (gatherEvidence does both).
  const gathered = await gatherEvidence(
    {
      apiKey: env.ANTHROPIC_API_KEY,
      readerModel: env.REVIEW_READER_MODEL,
      readerContext: { title: game.title, description: game.description, fileList: input.files.map((file) => ({ path: file.path, sizeBytes: file.sizeBytes })), checkItems: input.staticEvidence, ...(input.reported !== undefined ? { reported: input.reported } : {}) },
      texts: input.texts,
      pictures,
      previous,
    },
    deps,
    (costCents) => addReviewUsage(env.DB, costCents),
  );
  const findings = [...gathered.findings];
  const read = { evidence: gathered.items, readFileSha256s: gathered.readFileSha256s };
  let cost = { cost_cents: gathered.costCents, input_token_count: gathered.inputTokenCount, output_token_count: gathered.outputTokenCount, ...(isSmallReview ? { is_small_review: true } : {}) };
  const hasChildSafetyItem = gathered.items.some((evidenceItem) => evidenceItem.kind === "content" && evidenceItem.subject === "child_safety");

  if (!input.isRecheck) {
    // (d) A tweak: nothing new in the evidence since the game's last judged version that passed.
    if (!input.hasStaticHold && !hasChildSafetyItem && gathered.findings.length === 0) {
      const baseline = await tweakBaseline(env, game.id, version.id);
      const judged = baseline?.version;
      const judgedEvidence = baseline?.report.evidence;
      if (judged && judgedEvidence && isTweak(gathered.items, judgedEvidence, baseline.isHeld)) {
        await alertReviewBudget(env, budgetCents);
        return { ai: { ...models, verdict: "reused", reused_from_version_id: judged.id, summary: baseline.isHeld ? "Takes out what held the version before and adds nothing new in the evidence, so it passes." : "A tweak of a version that passed: nothing new in the evidence, so its verdict stands.", ...cost }, findings, isChildSafety: false, ...read };
      }
    }
    // (e) The owner's large reviews in the last 24 hours. Games with no owner (Zaisma's own) have no limit.
    if (game.owner_id && (await largeReviewCount(env, game.owner_id)) >= PLAN_LIMITS[plan].maximumLargeReviewsPerDay) {
      await alertReviewBudget(env, budgetCents);
      findings.push({ stage: "ai", severity: "hold", code: "daily_large_reviews_used", message: dailyReviewMeaning("daily_large_reviews_used", plan) });
      return { ai: { ...skipped("Waiting for one of the developer's daily large reviews."), ...cost }, findings, isChildSafety: hasChildSafetyItem, ...read };
    }
  }

  // (f) The judge, which reads the review precedents in force, and the hold this version answers, if any.
  const reviewPrecedents = await activeReviewPrecedents(env.DB);
  const held = input.isRecheck ? null : await heldBaseline(env, version);
  const earlierHold = held ? await earlierHoldOf(env, held, version, gathered.items) : undefined;
  const answer = await deps.judge(env.ANTHROPIC_API_KEY, env.REVIEW_JUDGE_MODEL, {
    title: game.title,
    description: game.description,
    fileCount: input.files.length,
    items: gathered.items,
    pictures: gathered.flaggedPictures,
    ...(input.reported !== undefined ? { reported: input.reported } : {}),
    reviewPrecedents,
    ...(earlierHold ? { earlierHold } : {}),
  });
  await addReviewUsage(env.DB, answer.costCents);
  await alertReviewBudget(env, budgetCents);
  cost = { ...cost, cost_cents: cost.cost_cents + answer.costCents, input_token_count: cost.input_token_count + answer.inputTokenCount, output_token_count: cost.output_token_count + answer.outputTokenCount };
  findings.push(...answer.findings);
  return { ai: { ...models, verdict: answer.verdict, reused_from_version_id: null, summary: answer.summary, ...(answer.followedReviewPrecedentNumbers.length ? { followed_review_precedent_ids: answer.followedReviewPrecedentNumbers.map((number) => reviewPrecedents[number - 1]!.id) } : {}), ...cost }, findings, isChildSafety: answer.isChildSafety || hasChildSafetyItem, ...read };
}

/**
 * The version a new one is compared with to be a tweak: the game's last judged version that was approved, or
 * held or rejected by the scan only for findings the new version can fix by removing what they stand on
 * (FIXABLE_FINDING_CODES), so the fix passes on the cheap reads. Never one stopped for child safety, by a person
 * or for anything else.
 */
async function tweakBaseline(env: Env, gameId: string, versionId: string): Promise<{ version: { id: string }; report: ScanReport; isHeld: boolean } | null> {
  const rows = await env.DB
    .prepare("SELECT id, scan_status, scan_report FROM versions WHERE game_id = ? AND id != ? AND judged_at_ms IS NOT NULL AND scan_status IN ('approved', 'held', 'rejected') AND (scan_status != 'rejected' OR review_reason IS NULL) ORDER BY created_at_ms DESC LIMIT 5")
    .bind(gameId, versionId)
    .all<{ id: string; scan_status: string; scan_report: string | null }>();
  for (const row of rows.results) {
    if (!row.scan_report) continue;
    const report = JSON.parse(row.scan_report) as ScanReport;
    if (row.scan_status === "approved") return { version: { id: row.id }, report, isHeld: false };
    const isFixable = !report.is_child_safety && report.findings.every((finding) => finding.severity === "info" || FIXABLE_FINDING_CODES.includes(finding.code));
    if (isFixable) return { version: { id: row.id }, report, isHeld: true };
  }
  return null;
}

/**
 * The hold a new version answers ("A fix is checked against its hold." in docs/DECISIONS.md): the game's newest
 * judged version, when the scan alone held or rejected it (a rejection is a hold a fix answers the same way). Never one held for child safety or known images, one a person
 * decided, or one a report paused: a fix can't answer those by itself. An approved newest one means there's no hold.
 */
export async function heldBaseline(env: Env, version: Pick<Version, "id" | "game_id" | "created_at_ms">): Promise<{ version: Version; report: ScanReport } | null> {
  const row = await env.DB
    .prepare("SELECT * FROM versions WHERE game_id = ? AND id != ? AND created_at_ms <= ? AND judged_at_ms IS NOT NULL ORDER BY created_at_ms DESC LIMIT 1")
    .bind(version.game_id, version.id, version.created_at_ms)
    .first<Version>();
  if (!row?.scan_report || (row.scan_status !== "held" && row.scan_status !== "rejected") || row.review_reason !== null || row.report_held_at_ms !== null) return null;
  const report = JSON.parse(row.scan_report) as ScanReport;
  if (report.is_child_safety || report.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)) return null;
  return { version: row, report };
}

/** The held version as the judge reads it: its non-info findings and summary, the files changed since, and which items it already had. */
async function earlierHoldOf(env: Env, held: { version: Version; report: ScanReport }, version: Version, items: EvidenceItem[]): Promise<EarlierHold> {
  const changes = await fileChanges(env, held.version, version);
  const heldEvidence = held.report.evidence ?? [];
  return {
    versionId: held.version.id,
    summary: held.report.ai?.summary ?? "",
    findings: held.report.findings.filter((finding) => finding.severity !== "info").map((finding) => ({ code: finding.code, message: finding.message, path: finding.path ?? null })),
    addedPaths: changes?.addedPaths ?? [],
    changedPaths: changes?.changedPaths ?? [],
    removedPaths: changes?.removedPaths ?? [],
    carriedItemNumbers: items.flatMap((evidenceItem, index) => (heldEvidence.some((heldItem) => isSameItem(heldItem, evidenceItem)) ? [index + 1] : [])),
  };
}

/** The paths added, changed and removed between two versions, sorted; null when either is a zip upload, whose files have no hash to compare. */
export async function fileChanges(env: Env, earlier: Version, version: Version): Promise<{ addedPaths: string[]; changedPaths: string[]; removedPaths: string[] } | null> {
  if (earlier.kind !== "files" || version.kind !== "files") return null;
  const shaOf = async (of: Version) => new Map((await versionFiles(env, of)).map((file) => [file.path, file.sha256]));
  const [before, after] = [await shaOf(earlier), await shaOf(version)];
  const sorted = (paths: string[]) => paths.sort((first, second) => (first < second ? -1 : 1));
  return {
    addedPaths: sorted([...after.keys()].filter((path) => !before.has(path))),
    changedPaths: sorted([...after.keys()].filter((path) => before.has(path) && before.get(path) !== after.get(path))),
    removedPaths: sorted([...before.keys()].filter((path) => !after.has(path))),
  };
}

/** What a person reviewing a held version sees changed (admin page and admin MCP): the version it's compared with, and the files since. */
export interface ChangesSince {
  earlier: Version;
  earlierReport: ScanReport;
  /** Null when either version is a zip upload. */
  files: { addedPaths: string[]; changedPaths: string[]; removedPaths: string[] } | null;
}

/** For a held version: the hold it answers (heldBaseline), or else the game's newest earlier version with a scan report, and the files changed since. */
export async function changesSince(env: Env, version: Version): Promise<ChangesSince | null> {
  if (version.scan_status !== "held") return null;
  const held = await heldBaseline(env, version);
  const earlier =
    held?.version ??
    (await env.DB.prepare("SELECT * FROM versions WHERE game_id = ? AND id != ? AND created_at_ms <= ? AND scan_report IS NOT NULL ORDER BY created_at_ms DESC LIMIT 1").bind(version.game_id, version.id, version.created_at_ms).first<Version>());
  if (!earlier?.scan_report) return null;
  return { earlier, earlierReport: held?.report ?? (JSON.parse(earlier.scan_report) as ScanReport), files: await fileChanges(env, earlier, version) };
}

/** The hosts of a game's own servers (own_server_urls, a JSON list of addresses), lowercase. */
function hostsOf(ownServerUrls: string): string[] {
  try {
    return (JSON.parse(ownServerUrls) as string[]).map((address) => new URL(address).hostname.toLowerCase());
  } catch {
    return [];
  }
}

/** The owner's large reviews in the last 24 hours (versions the judge ran on), across all their games. */
export async function largeReviewCount(env: Env, ownerId: string, nowMs = Date.now()): Promise<number> {
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS judged_count FROM versions JOIN games ON games.id = versions.game_id WHERE games.owner_id = ? AND versions.judged_at_ms > ? AND versions.is_review_refunded = 0")
    .bind(ownerId, nowMs - 24 * 60 * 60 * 1000)
    .first<{ judged_count: number }>();
  return row?.judged_count ?? 0;
}

/** The owner's small reviews in the last 24 hours (versions whose reads called the reader model), across all their games. */
export async function smallReviewCount(env: Env, ownerId: string, nowMs = Date.now()): Promise<number> {
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS read_count FROM versions JOIN games ON games.id = versions.game_id WHERE games.owner_id = ? AND versions.read_at_ms > ?")
    .bind(ownerId, nowMs - 24 * 60 * 60 * 1000)
    .first<{ read_count: number }>();
  return row?.read_count ?? 0;
}

/** The evidence an earlier scan of this game read, and the version it read: this version's own first, then the newest other. */
async function previousEvidence(env: Env, version: Version): Promise<{ version: Version; evidence: EvidenceItem[]; readFileSha256s: string[] } | null> {
  const row = await env.DB
    .prepare("SELECT * FROM versions WHERE game_id = ? AND json_extract(scan_report, '$.read_file_sha256s') IS NOT NULL ORDER BY id = ? DESC, created_at_ms DESC LIMIT 1")
    .bind(version.game_id, version.id)
    .first<Version>();
  if (!row) return null;
  const report = JSON.parse(row.scan_report!) as ScanReport;
  return { version: row, evidence: report.evidence ?? [], readFileSha256s: report.read_file_sha256s ?? [] };
}

/**
 * The earlier version's text at each path whose file changed, loaded only when the readers compare it, so they
 * read only what changed. Zip uploads have no hashes to compare: none.
 */
async function previousTexts(env: Env, earlierVersion: Version, texts: { path: string; sha256: string }[]): Promise<Map<string, EarlierText>> {
  const earlierTexts = new Map<string, EarlierText>();
  if (earlierVersion.kind !== "files") return earlierTexts;
  const shaByPath = new Map(texts.map((file) => [file.path, file.sha256]));
  for (const file of await versionFiles(env, earlierVersion).catch(() => [])) {
    const sha256 = shaByPath.get(file.path);
    if (!file.sha256 || sha256 === undefined || sha256 === file.sha256) continue;
    earlierTexts.set(file.path, { sha256: file.sha256, text: async () => {
      const body = await env.GAMES.get(file.key);
      return body ? new TextDecoder().decode(await body.arrayBuffer()) : null;
    } });
  }
  return earlierTexts;
}

/** The pictures the readers may look at, each hashed (the manifest's hash, or read once to hash it) and loaded again only when read. */
async function picturesToRead(env: Env, imageFiles: StoredFile[]): Promise<PictureFile[]> {
  const pictures: PictureFile[] = [];
  for (const file of chooseReadPictures(imageFiles)) {
    const load = async () => new Uint8Array(await (await env.GAMES.get(file.key))!.arrayBuffer());
    const sha256 = file.sha256 ?? (await sha256Hex(await load()));
    pictures.push({ path: file.path, mediaType: IMAGE_TYPES[extensionOf(file.path)] as ReaderPicture["mediaType"], sizeBytes: file.sizeBytes, sha256, base64: async () => toBase64(await load()) });
  }
  return pictures;
}

/** Julius hears once a month when the review has used budgetAlertPct of its budget. */
async function alertReviewBudget(env: Env, budgetCents: number): Promise<void> {
  const usage = await aiUsage(env.DB);
  if (usage.review_budget_alert_sent_at_ms !== null || usage.review_cost_cents < (budgetCents * REVIEW_LIMITS.budgetAlertPct) / 100) return;
  const claim = await env.DB.prepare("UPDATE ai_usage SET review_budget_alert_sent_at_ms = ? WHERE month = ? AND review_budget_alert_sent_at_ms IS NULL").bind(Date.now(), currentMonth()).run();
  if (!claim.meta.changes) return;
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  await sendAlert(
    env,
    `AI review budget at ${REVIEW_LIMITS.budgetAlertPct}%`,
    `The AI review has used ${dollars(usage.review_cost_cents)} of this month's ${dollars(budgetCents)} (AI_REVIEW_MONTHLY_BUDGET_CENTS). Past it, new versions wait for a person until next month, or until the budget is raised.`,
  );
}

/**
 * Versions held only until their owner had a free large or small review: once one of that kind frees up, oldest
 * first, they're scanned again by themselves (every 5 minutes, at most 50 a run). Their reading is reused, so a
 * version that waited for a large review reads nothing new. One a newer version replaced isn't scanned again.
 */
export async function rescanWaiting(env: Env, nowMs = Date.now()): Promise<number> {
  const { results } = await env.DB
    .prepare(
      `SELECT versions.id, games.owner_id, (SELECT json_extract(json_each.value, '$.code') FROM json_each(versions.scan_report, '$.findings') WHERE json_extract(json_each.value, '$.code') IN ('daily_large_reviews_used', 'daily_small_reviews_used')) AS waiting_code
       FROM versions JOIN games ON games.id = versions.game_id
       WHERE versions.scan_status = 'held' AND versions.replaced_by_version_id IS NULL AND EXISTS (SELECT 1 FROM json_each(versions.scan_report, '$.findings') WHERE json_extract(json_each.value, '$.code') IN ('daily_large_reviews_used', 'daily_small_reviews_used'))
       ORDER BY versions.created_at_ms LIMIT 200`,
    )
    .all<{ id: string; owner_id: string | null; waiting_code: "daily_large_reviews_used" | "daily_small_reviews_used" }>();
  const freeByOwnerAndKind = new Map<string, number>();
  const limitsByOwner = new Map<string, PlanLimits>();
  const queued: string[] = [];
  for (const waiting of results) {
    if (queued.length >= 50) break;
    const isSmall = waiting.waiting_code === "daily_small_reviews_used";
    const key = `${waiting.owner_id ?? ""}\n${isSmall ? "small" : "large"}`;
    if (!freeByOwnerAndKind.has(key)) {
      if (waiting.owner_id && !limitsByOwner.has(waiting.owner_id)) limitsByOwner.set(waiting.owner_id, await limitsFor(env.DB, waiting.owner_id, nowMs));
      const limits = waiting.owner_id ? limitsByOwner.get(waiting.owner_id)! : null;
      const freeReviewCount = !limits
        ? Infinity
        : isSmall
          ? limits.maximumSmallReviewsPerDay - (await smallReviewCount(env, waiting.owner_id!, nowMs))
          : limits.maximumLargeReviewsPerDay - (await largeReviewCount(env, waiting.owner_id!, nowMs));
      freeByOwnerAndKind.set(key, freeReviewCount);
    }
    if (freeByOwnerAndKind.get(key)! <= 0) continue;
    freeByOwnerAndKind.set(key, freeByOwnerAndKind.get(key)! - 1);
    queued.push(waiting.id);
  }
  for (const versionId of queued) await env.DB.prepare("UPDATE versions SET scan_status = 'scanning', scan_queued_at_ms = ? WHERE id = ? AND scan_status = 'held'").bind(nowMs, versionId).run();
  for (let index = 0; index < queued.length; index += 100) await env.SCAN_QUEUE.sendBatch(queued.slice(index, index + 100).map((versionId) => ({ body: { versionId } })));
  return queued.length;
}

/** A version's code files, read in full and hashed, and any that are really pictures or videos under a code file's name. */
async function readTexts(env: Env, files: StoredFile[]): Promise<{ texts: { path: string; text: string; sha256: string }[]; disguised: MediaForMatching[]; hasTooMuchCode: boolean }> {
  const texts: { path: string; text: string; sha256: string }[] = [];
  const disguised: MediaForMatching[] = [];
  let textSizeBytes = 0;
  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(extensionOf(file.path))) continue;
    if (textSizeBytes + file.sizeBytes > MAXIMUM_STATIC_TEXT_SIZE_BYTES) return { texts, disguised, hasTooMuchCode: true };
    const body = await env.GAMES.get(file.key);
    if (!body) continue;
    const bytes = new Uint8Array(await body.arrayBuffer());
    textSizeBytes += file.sizeBytes;
    const type = sniffMedia(bytes.subarray(0, SNIFF_BYTES));
    const sha256 = file.sha256 ?? (await sha256Hex(bytes));
    if (type && (type !== "video/webm" || matroskaHasVideo(bytes))) disguised.push({ path: file.path, type, id: file.key, sha256, body: async () => bytes });
    else texts.push({ path: file.path, text: new TextDecoder().decode(bytes), sha256 });
  }
  return { texts, disguised, hasTooMuchCode: false };
}

/** What image matching found, and how many pictures and videos it trusted from an earlier check instead of sending. */
export type MediaMatchResult = ImageMatchResult & { reusedMediaCount: number };

/**
 * Image matching on every picture and video in a version: by name, by their first bytes whatever they're
 * called (a picture renamed .bin), and written into code as base64. Files are streamed from storage, so
 * a big video never sits in memory. Audio-only WebM files aren't sent. A file cleared in the last 30 days
 * by every matcher connected now isn't sent again, and one whose first bytes said it's no picture isn't
 * read again (checked_files), so an update sends only what changed. Pictures stored inside packs (Godot .pck,
 * .glb, Emscripten .data, .wasm) are found and matched too, and so are Unity's and Godot's GPU textures, decoded
 * into pictures; a pack whose pictures all cleared isn't searched again.
 */
export async function matchMedia(env: Env, files: StoredFile[], texts: { path: string; text: string }[], disguised: MediaForMatching[], matcher: ImageMatcher, nowMs = Date.now()): Promise<MediaMatchResult> {
  if (matcher === notConnected) return { ...(await matcher.check([])), reusedMediaCount: 0 };
  const findings: Finding[] = [];
  const embedded: MediaForMatching[] = [];
  for (const textFile of texts) {
    for (const [i, { type, bytes }] of embeddedMedia(textFile.text).entries()) {
      embedded.push({ path: `${textFile.path} (picture ${i + 1} in the code)`, type, id: `embedded:${textFile.path}:${i}`, sha256: await sha256Hex(bytes), body: async () => bytes });
    }
  }
  const checked = await checkedFiles(env, [...files.map((file) => file.sha256), ...disguised.map((media) => media.sha256), ...embedded.map((media) => media.sha256)], nowMs);
  // Only Zaisma's own matchers are trusted from an earlier check: one plugged in by a self-hoster (or a test) always sees everything.
  const providers = connectedProviders(env);
  const isClearedRow = (row: CheckedFileRow | undefined) => providers.length > 0 && row?.is_media === 1 && row.provider !== null && providers.every((provider) => row.provider!.split("+").includes(provider));
  const isCleared = (sha256: string | undefined) => isClearedRow(sha256 ? checked.get(sha256) : undefined);
  let reusedMediaCount = 0;
  const media: MediaForMatching[] = [];
  const add = (candidate: MediaForMatching) => {
    if (isCleared(candidate.sha256)) reusedMediaCount++;
    else media.push(candidate);
  };
  disguised.forEach(add);
  const stored = (file: StoredFile, type: string): MediaForMatching => ({ path: file.path, type, id: file.key, ...(file.sha256 ? { sha256: file.sha256 } : {}), body: () => streamFile(env, file.key) });
  const sniffedNotMedia: string[] = [];
  const packs: StoredFile[] = [];
  let sniffedFileCount = 0;
  for (const file of files) {
    const extension = extensionOf(file.path);
    if (TEXT_EXTENSIONS.has(extension)) continue; // Read in full already.
    if (PACK_EXTENSIONS.has(extension) && file.sizeBytes >= 4) {
      // A pack is never remembered as "no picture": an old row like that is ignored, so it's searched inside once.
      if (isCleared(file.sha256)) {
        reusedMediaCount++;
        continue;
      }
      const type = sniffMedia(await readStart(env, file.key, SNIFF_BYTES));
      if (type && (type !== "video/webm" || matroskaHasVideo(await readStart(env, file.key, MATROSKA_HEAD_BYTES)))) media.push(stored(file, type));
      else if (file.sizeBytes >= MINIMUM_PACK_PICTURE_SIZE_BYTES) packs.push(file);
      continue;
    }
    const named = MATCH_TYPES[extension];
    if (named && named !== "video/webm") {
      add(stored(file, named));
      continue;
    }
    if (file.sizeBytes < 4) continue;
    if (isCleared(file.sha256)) {
      reusedMediaCount++;
      continue;
    }
    if (file.sha256 && checked.get(file.sha256)?.is_media === 0) continue; // Its first bytes said it's no picture.
    if (++sniffedFileCount > MAXIMUM_SNIFFED_FILE_COUNT) continue;
    const start = await readStart(env, file.key, SNIFF_BYTES);
    if (isUnityPack(start)) {
      packs.push(file); // An asset bundle, whatever it's called.
      continue;
    }
    const type = sniffMedia(start);
    if (!type || (type === "video/webm" && !matroskaHasVideo(await readStart(env, file.key, MATROSKA_HEAD_BYTES)))) {
      if (file.sha256) sniffedNotMedia.push(file.sha256);
      continue;
    }
    media.push(stored(file, type));
  }
  if (sniffedFileCount > MAXIMUM_SNIFFED_FILE_COUNT) findings.push({ stage: "images", severity: "hold", code: "too_many_files_to_check", message: `More than ${MAXIMUM_SNIFFED_FILE_COUNT} files that aren't code or pictures: the first ${MAXIMUM_SNIFFED_FILE_COUNT} were checked for hidden pictures, and a person should look at the rest.` });
  embedded.forEach(add);
  if (media.length > MAXIMUM_MATCHED_MEDIA_COUNT) findings.push({ stage: "images", severity: "hold", code: "too_many_images_to_check", message: `More than ${MAXIMUM_MATCHED_MEDIA_COUNT} pictures and videos: the first ${MAXIMUM_MATCHED_MEDIA_COUNT} were matched, and a person should look at the rest.` });
  const inside = await mediaInsidePacks(env, packs, async (hashes) => {
    const insideChecked = await checkedFiles(env, hashes, nowMs);
    return (sha256) => isClearedRow(insideChecked.get(sha256));
  });
  reusedMediaCount += inside.reusedMediaCount;
  if (inside.isCapped) findings.push({ stage: "images", severity: "info", code: "too_many_pictures_inside_packs", message: `More than ${MAXIMUM_PACK_PICTURE_COUNT} pictures inside packs: the first ${MAXIMUM_PACK_PICTURE_COUNT} were matched.` });
  const sent = [...media.slice(0, MAXIMUM_MATCHED_MEDIA_COUNT), ...inside.media];
  const matchResult = await matcher.check(sent);
  const clearedPackHashes = isMatchFinished(matchResult) && !inside.isCapped ? packs.filter((pack) => pack.sha256 && !matchResult.findings.some((finding) => finding.path?.startsWith(`${pack.path} (`))).map((pack) => pack.sha256!) : [];
  await saveCheckedFiles(env, sent, sniffedNotMedia, matchResult, nowMs, clearedPackHashes);
  return { ...matchResult, findings: [...findings, ...matchResult.findings], reusedMediaCount };
}

/**
 * The pictures stored inside packs, read a window at a time so a big pack never sits in memory whole, and the
 * textures, sprites and videos inside Unity builds and Godot packs. Each is hashed when it's found and read back
 * (and decoded) when it's sent; one cleared earlier, in this pack or any other, isn't sent again. A pack that
 * can't be read passes.
 */
async function mediaInsidePacks(env: Env, packs: StoredFile[], clearedAmong: (hashes: string[]) => Promise<(sha256: string) => boolean>): Promise<{ media: MediaForMatching[]; reusedMediaCount: number; isCapped: boolean }> {
  const found: MediaForMatching[] = [];
  const seenHashes = new Set<string>();
  // Found pictures are kept as references until cleared ones are looked up, so a pack of cleared pictures can hold more than are sent.
  const isFoundCapped = () => found.length >= MAXIMUM_PACK_PICTURE_COUNT * 4;
  const add = (picture: MediaForMatching & { sha256: string }) => {
    if (seenHashes.has(picture.sha256)) return;
    seenHashes.add(picture.sha256);
    found.push(picture);
  };
  for (const pack of packs) {
    let pictureNumber = 0;
    let windowStartIndex = 0;
    while (windowStartIndex < pack.sizeBytes && !isFoundCapped()) {
      const bytes = await readRange(env, pack.key, windowStartIndex, Math.min(PACK_WINDOW_SIZE_BYTES, pack.sizeBytes - windowStartIndex));
      if (bytes.length === 0) break;
      const { pictures, unfinishedStartIndex } = picturesInside(bytes);
      for (const picture of pictures) {
        const sizeBytes = picture.endIndex - picture.startIndex;
        if (sizeBytes < MINIMUM_PACK_PICTURE_SIZE_BYTES) continue;
        pictureNumber++;
        const pictureStartIndex = windowStartIndex + picture.startIndex;
        add({ path: `${pack.path} (picture ${pictureNumber} inside)`, type: picture.type, id: `${pack.key}#${pictureStartIndex}`, sha256: await sha256Hex(bytes.subarray(picture.startIndex, picture.endIndex)), body: () => readRange(env, pack.key, pictureStartIndex, sizeBytes) });
      }
      if (windowStartIndex + bytes.length >= pack.sizeBytes) break;
      windowStartIndex += unfinishedStartIndex === null ? bytes.length : Math.max(1, unfinishedStartIndex);
    }
    const source: ByteSource = { sizeBytes: pack.sizeBytes, read: (startIndex, sizeBytes) => readRange(env, pack.key, startIndex, sizeBytes) };
    const start = await readStart(env, pack.key, 16);
    const engine = isUnityPack(start) ? unityPicturesInside(source) : isGodotPack(start) ? godotPicturesInside(source) : null;
    if (!engine) continue;
    try {
      for await (const picture of engine) {
        if (isFoundCapped()) break;
        add({ path: `${pack.path} (${picture.label} inside)`, type: picture.type, id: `${pack.key}#${picture.sha256}`, sha256: picture.sha256, body: picture.body });
      }
    } catch {
      // A pack that can't be read passes, like an encrypted one.
    }
  }
  const isCleared = await clearedAmong([...seenHashes]);
  const media: MediaForMatching[] = [];
  let reusedMediaCount = 0;
  let isCapped = isFoundCapped();
  for (const picture of found) {
    if (isCleared(picture.sha256!)) reusedMediaCount++;
    else if (media.length < MAXIMUM_PACK_PICTURE_COUNT) media.push(picture);
    else isCapped = true;
  }
  return { media, reusedMediaCount, isCapped };
}

/** Whether every connected matcher finished: no finding about matching itself, only about pictures. */
function isMatchFinished(matchResult: ImageMatchResult): boolean {
  return matchResult.isConnected && !matchResult.findings.some((finding) => finding.stage === "images" && finding.severity !== "info" && !finding.path);
}

interface CheckedFileRow {
  sha256: string;
  is_media: number;
  provider: string | null;
}

/** The files among these hashes the scan checked in the last 30 days. */
async function checkedFiles(env: Env, hashes: (string | undefined)[], nowMs: number): Promise<Map<string, CheckedFileRow>> {
  const unique = [...new Set(hashes.filter((hash): hash is string => !!hash))];
  const checked = new Map<string, CheckedFileRow>();
  const sinceMs = nowMs - CHECKED_FILE_KEPT_DURATION_DAYS * 24 * 60 * 60 * 1000;
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    statements.push(env.DB.prepare(`SELECT sha256, is_media, provider FROM checked_files WHERE checked_at_ms > ? AND sha256 IN (${chunk.map(() => "?").join(",")})`).bind(sinceMs, ...chunk));
  }
  for (let i = 0; i < statements.length; i += 50) {
    for (const batch of await env.DB.batch<CheckedFileRow>(statements.slice(i, i + 50))) for (const row of batch.results) checked.set(row.sha256, row);
  }
  return checked;
}

/**
 * Remembers what this scan cleared: every picture and video sent that no finding names, when the matchers
 * finished, every pack whose pictures all cleared (as a cleared picture, so it isn't searched again), and every
 * file whose first bytes said it's no picture. A known match is never recorded, so it's always found again.
 */
async function saveCheckedFiles(env: Env, sent: MediaForMatching[], sniffedNotMedia: string[], matchResult: ImageMatchResult, nowMs: number, clearedPackHashes: string[] = []): Promise<void> {
  const isFinished = isMatchFinished(matchResult);
  const flaggedHashes = new Set(sent.filter((sentMedia) => matchResult.findings.some((finding) => finding.path === sentMedia.path)).map((sentMedia) => sentMedia.sha256));
  const cleared = isFinished ? [...new Set([...sent.map((sentMedia) => sentMedia.sha256).filter((hash): hash is string => !!hash && !flaggedHashes.has(hash)), ...clearedPackHashes])] : [];
  const upsert = "INSERT INTO checked_files (sha256, is_media, provider, checked_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT (sha256) DO UPDATE SET is_media = excluded.is_media, provider = excluded.provider, checked_at_ms = excluded.checked_at_ms";
  const statements = [
    ...cleared.map((sha256) => env.DB.prepare(upsert).bind(sha256, 1, matchResult.provider, nowMs)),
    ...[...new Set(sniffedNotMedia)].map((sha256) => env.DB.prepare(upsert).bind(sha256, 0, null, nowMs)),
  ];
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
}

/** A stored file as a stream of known length: sent to the matcher without holding it in memory. */
async function streamFile(env: Env, key: string): Promise<ReadableStream> {
  const object = await env.GAMES.get(key);
  if (!object) throw new Error(`No file at ${key}`);
  const { readable, writable } = new FixedLengthStream(object.size);
  object.body.pipeTo(writable).catch(() => {});
  return readable;
}

async function readStart(env: Env, key: string, sizeBytes: number): Promise<Uint8Array> {
  return readRange(env, key, 0, sizeBytes);
}

async function readRange(env: Env, key: string, startIndex: number, sizeBytes: number): Promise<Uint8Array> {
  const object = await env.GAMES.get(key, { range: { offset: startIndex, length: sizeBytes } });
  return object ? new Uint8Array(await object.arrayBuffer()) : new Uint8Array();
}

/**
 * Versions image matching hasn't fully checked yet, queued once a day: ones that passed before it was
 * connected, and ones a connected matcher (like PhotoDNA, added later or down at the time) hasn't finished.
 */
export async function queueImageChecks(env: Env, matcher = imageMatcher(env), providers = connectedProviders(env)): Promise<number> {
  if (matcher === notConnected) return 0;
  const unfinishedBy = providers.map(() => " OR instr(coalesce(json_extract(scan_report, '$.images.provider'), ''), ?) = 0").join("");
  const { results } = await env.DB
    .prepare(`SELECT id FROM versions WHERE scan_status = 'approved' AND (scan_report IS NULL OR json_extract(scan_report, '$.images.is_connected') IS NOT 1${unfinishedBy}) ORDER BY created_at_ms DESC LIMIT 1000`)
    .bind(...providers)
    .all<{ id: string }>();
  for (let i = 0; i < results.length; i += 100) await env.SCAN_QUEUE.sendBatch(results.slice(i, i + 100).map((version) => ({ body: { versionId: version.id, isImageRecheck: true } })));
  return results.length;
}

/**
 * Image matching on a version that already passed review (it passed before matching was connected).
 * A match takes it off at once (holdKnownImages). Otherwise its report notes the check, so it isn't
 * checked again; if Shield couldn't finish, this throws and the queue tries again.
 */
export async function recheckImages(env: Env, versionId: string, deps: ScanDeps = scanDeps(env)): Promise<void> {
  const version = await versionById(env.DB, versionId);
  const game = version && (await gameById(env.DB, version.game_id));
  if (!version || !game || version.scan_status !== "approved" || deps.images === notConnected) return;
  const files = await versionFiles(env, version);
  const { texts, disguised, hasTooMuchCode } = await readTexts(env, files);
  const matchResult = await matchMedia(env, files, texts, disguised, deps.images);
  if (matchResult.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)) {
    await holdKnownImages(env, game, version, matchResult, "Image matching on a version that passed before it was connected");
    return;
  }
  const unfinished = matchResult.findings.filter((finding) => finding.code === "image_matching_failed" && !finding.path);
  if (unfinished.length) throw new Error(summarize(unfinished));
  const report = reportOf(version);
  report.images = { provider: matchResult.provider, is_connected: true, checked_media_count: matchResult.checkedMediaCount, reused_media_count: matchResult.reusedMediaCount };
  await env.DB.prepare("UPDATE versions SET scan_report = ? WHERE id = ?").bind(JSON.stringify(report), version.id).run();
  // A matcher that didn't finish (image_matching_later, an info) gets its turn with tomorrow's batch: no alert for it.
  const loose = [...matchResult.findings.filter((finding) => finding.severity !== "info"), ...(hasTooMuchCode ? [{ stage: "static", severity: "hold", code: "too_much_code", message: "More code than the checks read." } as Finding] : [])];
  await audit(env.DB, game.id, "images-checked", `${version.id}: ${matchResult.checkedMediaCount} pictures and videos matched, no known abuse material${loose.length ? `\nNot fully checked:\n${summarize(loose)}` : ""}`);
  if (loose.length) await sendAlert(env, `${game.slug}: some files couldn't be image-matched`, `Version ${version.id} passed before image matching was connected. It was matched now and nothing known was found, but:\n\n${summarize(loose)}\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`);
}

/**
 * Pictures or videos in a version that already passed matched known abuse material: it comes off at
 * once, whatever its age or reports. Held, its preview link and scheduled publish off, the game hidden
 * if players get this version, and an urgent alert. Nothing is deleted. Returns whether the game was hidden.
 */
export async function holdKnownImages(env: Env, game: Game, version: Version, images: ImageMatchResult, why: string): Promise<boolean> {
  const knownImageFindings = images.findings.filter((finding) => finding.code === KNOWN_IMAGE_CODE);
  const report = reportOf(version);
  report.findings = [...report.findings.filter((finding) => finding.code !== KNOWN_IMAGE_CODE), ...knownImageFindings];
  report.decision = "held";
  report.is_child_safety = true;
  report.images = { provider: images.provider, is_connected: images.isConnected, checked_media_count: images.checkedMediaCount };
  await env.DB.prepare("UPDATE versions SET scan_status = 'held', preview_link_key = NULL, scheduled_publish_at_ms = NULL, scan_report = ? WHERE id = ?").bind(JSON.stringify(report), version.id).run();
  const isGameHidden = game.live_version_id === version.id && game.review_status === "live";
  // Never described to the developer: they're told a person needs to look.
  if (isGameHidden) await setReviewStatus(env.DB, game.id, "held", reviewReason("needs_review"));
  await audit(env.DB, game.id, "image-match-hold", `${why}: ${version.id} is held${isGameHidden ? " and the game is hidden" : ""}\n${summarize(knownImageFindings)}`);
  await tellWebhooks(env, "scan_status_changed", game.id, { versionId: version.id });
  if (isGameHidden) await tellWebhooks(env, "review_status_changed", game.id, {});
  await sendAlert(env, `URGENT: known abuse images in ${game.slug}${isGameHidden ? " (game hidden)" : ""}`, `${why}.\n\n${KNOWN_IMAGE_ALERT}${isGameHidden ? " The game is hidden from players." : ""}\n\n${summarize(knownImageFindings)}\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`);
  return isGameHidden;
}

function reportOf(version: Version): ScanReport {
  return version.scan_report ? (JSON.parse(version.scan_report) as ScanReport) : emptyReport("approved", []);
}

const emptyReport = (decision: ScanReport["decision"], findings: Finding[]): ScanReport => ({
  finished_at_ms: Date.now(),
  decision,
  findings,
  outside_hosts: [],
  images: { provider: "none", is_connected: false, checked_media_count: 0 },
  ai: null,
  is_child_safety: false,
  has_threads: false,
});

/** A scan that didn't finish after its tries: held for a person, the error kept for Zaisma's eyes. */
const scanFailedReport = (error: string): ScanReport => emptyReport("held", [{ stage: "static", severity: "hold", code: "scan_failed", message: `The scan didn't finish: ${error.slice(0, 300)}` }]);

export function summarize(findings: Finding[]): string {
  const important = findings.filter((finding) => finding.severity !== "info");
  return important.length ? important.map((finding) => `${finding.code}: ${finding.message}`).join("\n") : "No problems found.";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** VirusTotal's answer about a file, in its own words: how many antivirus engines flag it. */
interface VirusTotalAnswer {
  data?: { attributes?: { last_analysis_stats?: { malicious?: number } } };
}

/**
 * Optional VirusTotal hash lookup for the four largest scripts (free API: 4 lookups a minute). An answer from
 * the last week (or "doesn't know the file" from the last day) is reused from antivirus_lookups, not looked up again.
 */
async function virusTotal(env: Env, files: StoredFile[], nowMs = Date.now()): Promise<Finding[]> {
  const findings: Finding[] = [];
  const scripts = files.filter((file) => ["js", "mjs", "wasm", "html"].includes(extensionOf(file.path))).sort((first, second) => second.sizeBytes - first.sizeBytes).slice(0, 4);
  for (const file of scripts) {
    const hash = file.sha256 ?? (await sha256Hex(await (await env.GAMES.get(file.key))!.arrayBuffer()));
    let maliciousEngineCount = await storedAntivirusAnswer(env, hash, nowMs);
    if (maliciousEngineCount === undefined) {
      const response = await fetch(`https://www.virustotal.com/api/v3/files/${hash}`, { headers: { "x-apikey": env.VT_API_KEY! } });
      if (response.status !== 404 && !response.ok) {
        findings.push({ stage: "static", severity: "info", code: "antivirus_unavailable", message: `VirusTotal lookup failed (${response.status}).`, path: file.path });
        continue;
      }
      maliciousEngineCount = response.status === 404 ? null : (((await response.json()) as VirusTotalAnswer).data?.attributes?.last_analysis_stats?.malicious ?? 0);
      await env.DB
        .prepare("INSERT INTO antivirus_lookups (sha256, malicious_engine_count, looked_up_at_ms) VALUES (?, ?, ?) ON CONFLICT (sha256) DO UPDATE SET malicious_engine_count = excluded.malicious_engine_count, looked_up_at_ms = excluded.looked_up_at_ms")
        .bind(hash, maliciousEngineCount, nowMs)
        .run();
    }
    if (maliciousEngineCount === null) continue;
    if (maliciousEngineCount >= 3) findings.push({ stage: "static", severity: "reject", code: "antivirus_flag", message: `${maliciousEngineCount} antivirus engines flag this file.`, path: file.path });
    else if (maliciousEngineCount > 0) findings.push({ stage: "static", severity: "hold", code: "antivirus_flag", message: `${maliciousEngineCount} antivirus engine(s) flag this file.`, path: file.path });
  }
  return findings;
}

/** VirusTotal's stored answer about a file: its count, null when it didn't know the file, undefined when it's to be looked up. */
async function storedAntivirusAnswer(env: Env, sha256: string, nowMs: number): Promise<number | null | undefined> {
  const row = await env.DB.prepare("SELECT malicious_engine_count, looked_up_at_ms FROM antivirus_lookups WHERE sha256 = ?").bind(sha256).first<{ malicious_engine_count: number | null; looked_up_at_ms: number }>();
  if (!row) return undefined;
  const keptDurationDays = row.malicious_engine_count === null ? ANTIVIRUS_UNKNOWN_FILE_KEPT_DURATION_DAYS : ANTIVIRUS_ANSWER_KEPT_DURATION_DAYS;
  return row.looked_up_at_ms > nowMs - keptDurationDays * 24 * 60 * 60 * 1000 ? row.malicious_engine_count : undefined;
}

export interface StoredFile {
  /** Path inside the game. */
  path: string;
  /** Where the file is in the games bucket. */
  key: string;
  sizeBytes: number;
  /** From the manifest, for file-by-file uploads; zip uploads' files are hashed when they're read. */
  sha256?: string;
}

export async function versionFiles(env: Env, version: Version): Promise<StoredFile[]> {
  if (version.kind === "files") {
    const manifest = await env.GAMES.get(manifestKey(version.id));
    if (!manifest) throw new Error(`No manifest for version ${version.id}`);
    const { files } = (await manifest.json()) as Manifest;
    // A manifest lists where each file is; the blobs tables know their sizes.
    const sizes = await blobSizes(env.DB, Object.values(files).map((file) => file.sha256));
    return Object.entries(files).map(([path, file]) => ({ path, key: file.owner_id ? ownedBlobKey(file.owner_id, file.sha256) : blobKey(file.sha256), sizeBytes: sizes.get(file.sha256) ?? 0, sha256: file.sha256 }));
  }
  const out: StoredFile[] = [];
  let cursor: string | undefined;
  do {
    const list = await env.GAMES.list({ prefix: `${version.r2_prefix}/`, cursor });
    for (const object of list.objects) out.push({ path: object.key.slice(version.r2_prefix.length + 1), key: object.key, sizeBytes: object.size });
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return out;
}

/**
 * A version passed review (the scan or a person). Admin uploads and versions sent with
 * "publish when approved" go live; developers' drafts get a private preview link and wait.
 */
export async function passVersion(env: Env, version: Version, why: string, actor = "system"): Promise<void> {
  // Only the game's newest version goes live by itself, so an old approval never rolls the game back.
  const newer = await env.DB.prepare("SELECT 1 FROM versions WHERE game_id = ? AND created_at_ms > ? LIMIT 1").bind(version.game_id, version.created_at_ms).first();
  if (version.publish_when_approved_enabled && newer) {
    await approveDraft(env.DB, version.id);
    await audit(env.DB, version.game_id, "draft-ready", `${why}: ${version.id} is ready to preview and publish (a newer version exists, so it wasn't published)`, actor);
  } else if (version.publish_when_approved_enabled) {
    const game = await gameById(env.DB, version.game_id);
    const wasLiveVersion = game?.live_version_id ? await versionById(env.DB, game.live_version_id) : null;
    await publishVersion(env.DB, version);
    if (game && version.match_update_mode === "now") await updateLiveMatches(env, game, version, wasLiveVersion);
    await audit(env.DB, version.game_id, "published", `${why}: ${version.id}`, actor);
    await pruneVersions(env, version.game_id);
    await tellWebhooks(env, "live_version_changed", version.game_id, { versionId: version.id });
    await alertIfNoticeFixPublished(env, version.game_id, version.id);
  } else {
    await approveDraft(env.DB, version.id);
    await audit(env.DB, version.game_id, "draft-ready", `${why}: ${version.id} is ready to preview and publish`, actor);
  }
  await queuePerformanceCheck(env, version);
}

/**
 * The game was just set for 16 or 18 and up: versions held only because of lifelike gore pass, with no new scan
 * (the finding is already in their report). One a person decided, or held for anything else too, stays held.
 * Answers the versions that passed, newest first.
 */
export async function passVersionsHeldForGore(env: Env, game: Game, actor: string): Promise<Version[]> {
  const { results } = await env.DB.prepare("SELECT * FROM versions WHERE game_id = ? AND scan_status = 'held' AND review_reason IS NULL ORDER BY created_at_ms DESC").bind(game.id).all<Version>();
  const passed: Version[] = [];
  for (const version of results) {
    const report = version.scan_report ? (JSON.parse(version.scan_report) as ScanReport) : null;
    if (!report || report.is_child_safety) continue;
    const holds = report.findings.filter((finding) => finding.severity !== "info");
    if (holds.length === 0 || holds.some((finding) => finding.code !== "ai_lifelike_gore")) continue;
    for (const finding of report.findings) if (finding.code === "ai_lifelike_gore") finding.severity = "info";
    await saveScan(env.DB, version.id, "approved", { ...report, decision: "approved" });
    await passVersion(env, version, "Passed once the game was set for 16 and up", actor);
    passed.push(version);
  }
  return passed;
}

/**
 * A new version replaces the game's versions still waiting for review (being scanned, or held for a daily review
 * or a person): they step aside, aren't read or judged, and leave the person's queue. Never one held for child
 * safety or known images, one a person decided, or one a report paused.
 */
export async function replaceWaitingVersions(env: Env, gameId: string, newVersionId: string): Promise<void> {
  const { results } = await env.DB
    .prepare(
      `UPDATE versions SET replaced_by_version_id = ?
       WHERE game_id = ? AND id != ? AND replaced_by_version_id IS NULL AND scan_status IN ('scanning', 'held') AND report_held_at_ms IS NULL AND review_reason IS NULL
         AND (scan_report IS NULL OR (json_extract(scan_report, '$.is_child_safety') = 0 AND NOT EXISTS (SELECT 1 FROM json_each(scan_report, '$.findings') WHERE json_extract(json_each.value, '$.code') = ?)))
       RETURNING id`,
    )
    .bind(newVersionId, gameId, newVersionId, KNOWN_IMAGE_CODE)
    .all<{ id: string }>();
  for (const replaced of results) await audit(env.DB, gameId, "version-replaced", `${replaced.id} was replaced by ${newVersionId} before it was reviewed`);
}

/** Keep the live version plus the last few approved ones for rolling back; delete older approved versions. */
export async function pruneVersions(env: Env, gameId: string): Promise<void> {
  const game = await gameById(env.DB, gameId);
  const { results } = await env.DB.prepare("SELECT * FROM versions WHERE game_id = ? AND scan_status = 'approved' ORDER BY created_at_ms DESC").bind(gameId).all<Version>();
  // A version a tester link picked stays while the link is on, besides the ones kept for rolling back.
  const { results: picked } = await env.DB.prepare("SELECT picked_version_id FROM tester_links WHERE game_id = ? AND revoked_at_ms IS NULL AND version_choice = 'picked'").bind(gameId).all<{ picked_version_id: string }>();
  const pickedIds = new Set(picked.map((link) => link.picked_version_id));
  const oldVersions = results.filter((version) => version.id !== game?.live_version_id).slice(KEPT_VERSION_COUNT).filter((version) => !pickedIds.has(version.id));
  for (const oldVersion of oldVersions) await deleteVersion(env, oldVersion);
}

/** Delete a version and its own files. Shared files are left for the daily cleanup. */
export async function deleteVersion(env: Env, version: Version): Promise<void> {
  if (version.kind === "files") await env.GAMES.delete(manifestKey(version.id));
  else await deletePrefix(env.GAMES, version.r2_prefix);
  await env.DB.batch([env.DB.prepare("DELETE FROM performance_checks WHERE version_id = ?").bind(version.id), env.DB.prepare("DELETE FROM versions WHERE id = ?").bind(version.id)]);
}
