import {
  IMAGE_TYPES,
  REVIEW_CODES,
  REVIEW_LIMITS,
  TEXT_EXTENSIONS,
  addAiUsage,
  addReviewUsage,
  aiUsage,
  currentMonth,
  FIXABLE_FINDING_CODES,
  isTweak,
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
  SNIFF_BYTES,
  approveDraft,
  arachnidShield,
  eitherMatcher,
  photoDna,
  type PhotoDnaPriority,
  type PhotoDnaService,
  embeddedMedia,
  matroskaHasVideo,
  sniffMedia,
  type MediaForMatching,
  blobKey,
  blobSizes,
  ownedBlobKey,
  manifestKey,
} from "@zaisma/core";
import { deletePrefix } from "./upload.ts";
import { chooseReadPictures, gatherEvidence, readCode, readPictures, type PictureFile, type ReadCode, type ReadPictures, type ReaderPicture } from "./review-readers.ts";
import { judgeVersion, type JudgeVersion } from "./review-judge.ts";
import { tellWebhooks } from "./webhooks.ts";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";
import { recheckFailed, recheckVersion } from "./triage.ts";
import { turnOffLeakedKeys } from "./leaked-keys.ts";

/** Most text we read for the static checks. Bigger games are held for a person. */
const MAXIMUM_STATIC_TEXT_SIZE_BYTES = 40 * 1024 * 1024;
/** Most pictures and videos matched per version (each is a request to the matcher and one to storage). More are held for a person. */
export const MAXIMUM_MATCHED_MEDIA_COUNT = 5000;
/** Most other files whose first bytes are read, to find pictures and videos under other names. More are held for a person. */
export const MAXIMUM_SNIFFED_FILE_COUNT = 5000;

export interface ScanDeps {
  images: ImageMatcher;
  /** The AI review's readers and judge (review-readers.ts, review-judge.ts). */
  readCode: ReadCode;
  readPictures: ReadPictures;
  judge: JudgeVersion;
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

/** The photodna Worker as the matcher sees it. Pictures are read whole: PhotoDNA hashes one at a time. */
function photoDnaService(worker: NonNullable<Env["PHOTODNA"]>, apiKey: string): PhotoDnaService {
  return {
    async hash(media) {
      const body = await media.body();
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      return worker.hash(bytes);
    },
    match: (hashes, priority) => worker.match(apiKey, hashes, priority),
  };
}

/** The providers a version still needs matching by: the connected ones its report doesn't name as finished. */
function connectedProviders(env: Env): string[] {
  return [...(env.ARACHNID_SHIELD_KEY ? ["arachnid-shield"] : []), ...(env.PHOTODNA_KEY && env.PHOTODNA ? ["photodna"] : [])];
}

export const scanDeps = (env: Env, priority: PhotoDnaPriority = "upload"): ScanDeps => ({ images: imageMatcher(env, priority), readCode, readPictures, judge: judgeVersion });

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
  // Counts toward the owner's judged reviews a day (step 4e); re-checks never get here.
  if (isJudged(report)) await env.DB.prepare("UPDATE versions SET judged_at_ms = ? WHERE id = ?").bind(report.finished_at_ms, version.id).run();
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
    } else if ((decision === "held" && !isOnlyWaitingForDailyReview(findings)) || isChildSafety) {
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

/** Held only to wait for a free daily review: the cron scans it again, so nobody needs an alert. */
const isOnlyWaitingForDailyReview = (findings: Finding[]): boolean => {
  const holds = findings.filter((finding) => finding.severity !== "info");
  return holds.length > 0 && holds.every((finding) => finding.code === "daily_reviews_used");
};

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

  // 3. Known-illegal-image matching, before any picture is passed on.
  const imageFiles = files.filter((file) => extensionOf(file.path) in IMAGE_TYPES);
  const images = await matchMedia(env, files, texts, disguised, deps.images);
  findings.push(...images.findings);
  const hasKnownImage = images.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE);

  // 4. AI review: the checks' evidence and the readers', then one judge, within the monthly budget. Never with
  // pictures that matched known abuse material. `reviewCase` in review-set.ts mirrors steps 2 and 4b, 4c and 4f;
  // keep them in step (test/site/review-set.test.ts checks).
  const isRecheck = reported !== undefined;
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
    images: { provider: images.provider, is_connected: images.isConnected, checked_media_count: images.checkedMediaCount },
    ai: review.ai,
    is_child_safety: isChildSafety,
    ...(review.evidence ? { evidence: review.evidence, read_file_sha256s: review.readFileSha256s } : {}),
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
 * Step 4 of a scan: (a) the budget, (b) the readers, reusing what an earlier version's readers read in files
 * that haven't changed, (c) only items whose quotes are in the files, (d) a tweak of a version that passed
 * reuses its verdict, (e) the owner's judged reviews a day, (f) the judge. A re-check after a report always
 * reads afresh with the report in mind and always runs the judge, and never counts toward the day.
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
  await addAiUsage(env.DB, 0, 0, "scans");

  // (b) Read, and (c) keep only items whose quotes are in the files (gatherEvidence does both).
  const previous = input.isRecheck ? null : await previousEvidence(env, version);
  const gathered = await gatherEvidence(
    {
      apiKey: env.ANTHROPIC_API_KEY,
      readerModel: env.REVIEW_READER_MODEL,
      readerContext: { title: game.title, description: game.description, fileList: input.files.map((file) => ({ path: file.path, sizeBytes: file.sizeBytes })), checkItems: input.staticEvidence, ...(input.reported !== undefined ? { reported: input.reported } : {}) },
      texts: input.texts,
      pictures: await picturesToRead(env, input.imageFiles),
      previous,
    },
    deps,
    (costCents) => addReviewUsage(env.DB, costCents),
  );
  const findings = [...gathered.findings];
  const read = { evidence: gathered.items, readFileSha256s: gathered.readFileSha256s };
  let cost = { cost_cents: gathered.costCents, input_token_count: gathered.inputTokenCount, output_token_count: gathered.outputTokenCount };
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
    // (e) The owner's judged reviews in the last 24 hours. Games with no owner (Zaisma's own) have no limit.
    if (game.owner_id && (await judgedReviewCount(env, game.owner_id)) >= REVIEW_LIMITS.maximumJudgedReviewsPerDay) {
      await alertReviewBudget(env, budgetCents);
      findings.push({ stage: "ai", severity: "hold", code: "daily_reviews_used", message: REVIEW_CODES.daily_reviews_used.meaning });
      return { ai: { ...skipped("Waiting for one of the developer's daily reviews."), ...cost }, findings, isChildSafety: hasChildSafetyItem, ...read };
    }
  }

  // (f) The judge.
  const answer = await deps.judge(env.ANTHROPIC_API_KEY, env.REVIEW_JUDGE_MODEL, {
    title: game.title,
    description: game.description,
    fileCount: input.files.length,
    items: gathered.items,
    pictures: gathered.flaggedPictures,
    ...(input.reported !== undefined ? { reported: input.reported } : {}),
  });
  await addReviewUsage(env.DB, answer.costCents);
  await alertReviewBudget(env, budgetCents);
  cost = { cost_cents: cost.cost_cents + answer.costCents, input_token_count: cost.input_token_count + answer.inputTokenCount, output_token_count: cost.output_token_count + answer.outputTokenCount };
  findings.push(...answer.findings);
  return { ai: { ...models, verdict: answer.verdict, reused_from_version_id: null, summary: answer.summary, ...cost }, findings, isChildSafety: answer.isChildSafety || hasChildSafetyItem, ...read };
}

/**
 * The version a new one is compared with to be a tweak: the game's last judged version that was approved, or
 * held only for findings the new version can fix by removing what they stand on (FIXABLE_FINDING_CODES), so the
 * fix for a hold passes on the cheap reads. Never one that was rejected, held for child safety or held for
 * anything else.
 */
async function tweakBaseline(env: Env, gameId: string, versionId: string): Promise<{ version: { id: string }; report: ScanReport; isHeld: boolean } | null> {
  const rows = await env.DB
    .prepare("SELECT id, scan_status, scan_report FROM versions WHERE game_id = ? AND id != ? AND judged_at_ms IS NOT NULL AND scan_status IN ('approved', 'held') ORDER BY created_at_ms DESC LIMIT 5")
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

/** The hosts of a game's own servers (own_server_urls, a JSON list of addresses), lowercase. */
function hostsOf(ownServerUrls: string): string[] {
  try {
    return (JSON.parse(ownServerUrls) as string[]).map((address) => new URL(address).hostname.toLowerCase());
  } catch {
    return [];
  }
}

/** The owner's versions the judge ran on in the last 24 hours, across all their games. */
async function judgedReviewCount(env: Env, ownerId: string, nowMs = Date.now()): Promise<number> {
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS judged_count FROM versions JOIN games ON games.id = versions.game_id WHERE games.owner_id = ? AND versions.judged_at_ms > ?")
    .bind(ownerId, nowMs - 24 * 60 * 60 * 1000)
    .first<{ judged_count: number }>();
  return row?.judged_count ?? 0;
}

/** The evidence an earlier scan of this game read: this version's own first, then the newest other. */
async function previousEvidence(env: Env, version: Version): Promise<{ evidence: EvidenceItem[]; readFileSha256s: string[] } | null> {
  const row = await env.DB
    .prepare("SELECT scan_report FROM versions WHERE game_id = ? AND json_extract(scan_report, '$.read_file_sha256s') IS NOT NULL ORDER BY id = ? DESC, created_at_ms DESC LIMIT 1")
    .bind(version.game_id, version.id)
    .first<{ scan_report: string }>();
  if (!row) return null;
  const report = JSON.parse(row.scan_report) as ScanReport;
  return { evidence: report.evidence ?? [], readFileSha256s: report.read_file_sha256s ?? [] };
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
 * Versions held only until their owner had a free judged review: once one frees up, oldest first, they're
 * scanned again by themselves (every 5 minutes, at most 50 a run). Their reading is reused.
 */
export async function rescanWaiting(env: Env, nowMs = Date.now()): Promise<number> {
  const { results } = await env.DB
    .prepare(
      `SELECT versions.id, games.owner_id FROM versions JOIN games ON games.id = versions.game_id
       WHERE versions.scan_status = 'held' AND EXISTS (SELECT 1 FROM json_each(versions.scan_report, '$.findings') WHERE json_extract(json_each.value, '$.code') = 'daily_reviews_used')
       ORDER BY versions.created_at_ms LIMIT 200`,
    )
    .all<{ id: string; owner_id: string | null }>();
  const freeByOwner = new Map<string, number>();
  const queued: string[] = [];
  for (const waiting of results) {
    if (queued.length >= 50) break;
    const owner = waiting.owner_id ?? "";
    if (!freeByOwner.has(owner)) freeByOwner.set(owner, waiting.owner_id ? REVIEW_LIMITS.maximumJudgedReviewsPerDay - (await judgedReviewCount(env, waiting.owner_id, nowMs)) : Infinity);
    if (freeByOwner.get(owner)! <= 0) continue;
    freeByOwner.set(owner, freeByOwner.get(owner)! - 1);
    queued.push(waiting.id);
  }
  for (const versionId of queued) await env.DB.prepare("UPDATE versions SET scan_status = 'scanning' WHERE id = ? AND scan_status = 'held'").bind(versionId).run();
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
    if (type && (type !== "video/webm" || matroskaHasVideo(bytes))) disguised.push({ path: file.path, type, id: file.key, body: async () => bytes });
    else texts.push({ path: file.path, text: new TextDecoder().decode(bytes), sha256: file.sha256 ?? (await sha256Hex(bytes)) });
  }
  return { texts, disguised, hasTooMuchCode: false };
}

/**
 * Image matching on every picture and video in a version: by name, by their first bytes whatever they're
 * called (a picture renamed .bin), and written into code as base64. Files are streamed from storage, so
 * a big video never sits in memory. Audio-only WebM files aren't sent.
 */
export async function matchMedia(env: Env, files: StoredFile[], texts: { path: string; text: string }[], disguised: MediaForMatching[], matcher: ImageMatcher): Promise<ImageMatchResult> {
  if (matcher === notConnected) return matcher.check([]);
  const findings: Finding[] = [];
  const media: MediaForMatching[] = [...disguised];
  const stored = (file: StoredFile, type: string): MediaForMatching => ({ path: file.path, type, id: file.key, body: () => streamFile(env, file.key) });
  let sniffedFileCount = 0;
  for (const file of files) {
    const extension = extensionOf(file.path);
    if (TEXT_EXTENSIONS.has(extension)) continue; // Read in full already.
    const named = MATCH_TYPES[extension];
    if (named && named !== "video/webm") {
      media.push(stored(file, named));
      continue;
    }
    if (file.sizeBytes < 4) continue;
    if (++sniffedFileCount > MAXIMUM_SNIFFED_FILE_COUNT) continue;
    const type = sniffMedia(await readStart(env, file.key, SNIFF_BYTES));
    if (!type || (type === "video/webm" && !matroskaHasVideo(await readStart(env, file.key, MATROSKA_HEAD_BYTES)))) continue;
    media.push(stored(file, type));
  }
  if (sniffedFileCount > MAXIMUM_SNIFFED_FILE_COUNT) findings.push({ stage: "images", severity: "hold", code: "too_many_files_to_check", message: `More than ${MAXIMUM_SNIFFED_FILE_COUNT} files that aren't code or pictures: the first ${MAXIMUM_SNIFFED_FILE_COUNT} were checked for hidden pictures, and a person should look at the rest.` });
  for (const textFile of texts) {
    embeddedMedia(textFile.text).forEach(({ type, bytes }, i) => media.push({ path: `${textFile.path} (picture ${i + 1} in the code)`, type, id: `embedded:${textFile.path}:${i}`, body: async () => bytes }));
  }
  if (media.length > MAXIMUM_MATCHED_MEDIA_COUNT) findings.push({ stage: "images", severity: "hold", code: "too_many_images_to_check", message: `More than ${MAXIMUM_MATCHED_MEDIA_COUNT} pictures and videos: the first ${MAXIMUM_MATCHED_MEDIA_COUNT} were matched, and a person should look at the rest.` });
  const matchResult = await matcher.check(media.slice(0, MAXIMUM_MATCHED_MEDIA_COUNT));
  return { ...matchResult, findings: [...findings, ...matchResult.findings] };
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
  const object = await env.GAMES.get(key, { range: { offset: 0, length: sizeBytes } });
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
  report.images = { provider: matchResult.provider, is_connected: true, checked_media_count: matchResult.checkedMediaCount };
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

/** Optional VirusTotal hash lookup for the four largest scripts (free API: 4 lookups a minute). */
async function virusTotal(env: Env, files: StoredFile[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  const scripts = files.filter((file) => ["js", "mjs", "wasm", "html"].includes(extensionOf(file.path))).sort((first, second) => second.sizeBytes - first.sizeBytes).slice(0, 4);
  for (const file of scripts) {
    const bytes = await (await env.GAMES.get(file.key))!.arrayBuffer();
    const hash = await sha256Hex(bytes);
    const response = await fetch(`https://www.virustotal.com/api/v3/files/${hash}`, { headers: { "x-apikey": env.VT_API_KEY! } });
    if (response.status === 404) continue;
    if (!response.ok) {
      findings.push({ stage: "static", severity: "info", code: "antivirus_unavailable", message: `VirusTotal lookup failed (${response.status}).`, path: file.path });
      continue;
    }
    const answer = (await response.json()) as VirusTotalAnswer;
    const maliciousEngineCount = answer.data?.attributes?.last_analysis_stats?.malicious ?? 0;
    if (maliciousEngineCount >= 3) findings.push({ stage: "static", severity: "reject", code: "antivirus_flag", message: `${maliciousEngineCount} antivirus engines flag this file.`, path: file.path });
    else if (maliciousEngineCount > 0) findings.push({ stage: "static", severity: "hold", code: "antivirus_flag", message: `${maliciousEngineCount} antivirus engine(s) flag this file.`, path: file.path });
  }
  return findings;
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
  if (version.publish_when_approved_enabled) {
    await publishVersion(env.DB, version);
    await audit(env.DB, version.game_id, "published", `${why}: ${version.id}`, actor);
    await pruneVersions(env, version.game_id);
    await tellWebhooks(env, "live_version_changed", version.game_id, { versionId: version.id });
  } else {
    await approveDraft(env.DB, version.id);
    await audit(env.DB, version.game_id, "draft-ready", `${why}: ${version.id} is ready to preview and publish`, actor);
  }
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
  await env.DB.prepare("DELETE FROM versions WHERE id = ?").bind(version.id).run();
}
