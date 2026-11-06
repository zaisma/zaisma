import { audit, iso, newId } from "@zaisma/core";
import { authUserEmail, realEmail } from "./auth.ts";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";

/**
 * Reports to NCMEC's CyberTipline, as US law asks (18 U.S.C. 2258A), through its API
 * (report.cybertip.org/ispws/documentation). A known-image match is reported by itself within minutes and
 * pauses the account behind it; a child-safety case a person confirms (a chat review, a player report) waits
 * ready for a person's press, since a report names someone to the police. Nobody at Zaisma opens a matched
 * picture, and every report says so. What was sent is kept a year after it's sent, apart from game files and
 * untouched by deleting the game or the account, then erased (docs/DECISIONS.md, "A match reports itself").
 */

export const NCMEC_API_URL = "https://report.cybertip.org/ispws";

export const NCMEC_LIMITS = {
  /** More accounts than this with a match in one UTC day stop the sending: likelier a broken list than a wave. */
  maximumMatchedAccountCountPerDay: 3,
  /** Tries before a report is failed and Julius files it by hand: about half an hour of the 5-minute job. */
  maximumSendAttemptCount: 6,
  keptDurationDays: 365,
};

const DAY_MS = 86_400_000;

export const REPORT_SOURCES = ["image_match", "chat_review", "player_report"] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];
export const NCMEC_REPORT_STATUSES = ["ready", "waiting", "sent", "stopped_by_brake", "failed"] as const;
export type NcmecReportStatus = (typeof NCMEC_REPORT_STATUSES)[number];

const INCIDENT_TYPES = {
  image_match: "Child Pornography (possession, manufacture, and distribution)",
  chat_review: "Online Enticement of Children for Sexual Acts",
  player_report: "Online Enticement of Children for Sexual Acts",
} satisfies Record<ReportSource, string>;

/** One file kept for a report. */
export interface KeptFile {
  kept_key: string;
  original_path: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  match_message: string | null;
  is_publicly_available: boolean;
}

/** Exactly what a report sends, kept with it (ncmec_reports.details_json). */
export interface ReportDetails {
  incident_at_ms: number;
  incident_url: string | null;
  account: { account_id: string; username: string; email: string | null } | null;
  connection_address: string | null;
  uploaded_at_ms: number | null;
  intended_recipient_username: string | null;
  is_account_paused: boolean;
  additional_info: string;
  files: KeptFile[];
}

export interface NcmecReport {
  id: string;
  report_source: ReportSource;
  ncmec_report_status: NcmecReportStatus;
  account_id: string | null;
  game_id: string | null;
  version_id: string | null;
  chat_review_id: string | null;
  report_group_id: string | null;
  details_json: string;
  ncmec_report_number: string | null;
  send_attempt_count: number;
  last_error: string | null;
  created_at_ms: number;
  sent_at_ms: number | null;
  erase_at_ms: number | null;
}

/** A matched picture or video, in hand when it matched: its bytes, or where the games bucket keeps it. */
export interface MatchedMedia {
  path: string;
  contentType: string;
  matchMessage: string | null;
  isPubliclyAvailable: boolean;
  bytes?: Uint8Array;
  gamesKey?: string;
  /** Its SHA-256 in hex, when the match site knows it. */
  sha256?: string;
}

export interface MatchInput {
  /** Where it matched, in words for the alert: "a version of sky-hopper", "a forum image". */
  where: string;
  gameId: string | null;
  versionId: string | null;
  /** The uploader, when the match site knows it; otherwise the version's upload event, then the game's owner. */
  accountId: string | null;
  incidentUrl: string | null;
  connectionAddress?: string | null;
  uploadedAtMs?: number | null;
  media: MatchedMedia[];
}

export interface NcmecDeps {
  fetch: typeof fetch;
}

const defaultDeps = (): NcmecDeps => ({ fetch: (input, init) => fetch(input, init) });

/** Where reported files are kept: their own bucket, or the games bucket's reported/ folder where there's none (a self-hosted copy). */
const keptBucket = (env: Env): { bucket: R2Bucket; prefix: string } => (env.REPORTED ? { bucket: env.REPORTED, prefix: "" } : { bucket: env.GAMES, prefix: "reported/" });
const keptKeyOf = (env: Env, reportId: string, fileIndex: number) => `${keptBucket(env).prefix}${reportId}/${fileIndex}`;

export const reportById = (env: Env, id: string) => env.DB.prepare("SELECT * FROM ncmec_reports WHERE id = ?").bind(id).first<NcmecReport>();
export const detailsOf = (report: NcmecReport) => JSON.parse(report.details_json) as ReportDetails;

// --- A match reports itself ----------------------------------------------------------------------

/**
 * A known-image match: keep the files, pause the account, and report it to NCMEC now, unless more than
 * NCMEC_LIMITS.maximumMatchedAccountCountPerDay accounts matched today. A version already reported isn't
 * reported again (a re-check finds the same files). Answers the report, or null when there was nothing to keep.
 */
export async function reportMatch(env: Env, input: MatchInput, deps: NcmecDeps = defaultDeps(), nowMs = Date.now()): Promise<NcmecReport | null> {
  if (input.versionId) {
    const earlier = await env.DB.prepare("SELECT * FROM ncmec_reports WHERE report_source = 'image_match' AND version_id = ? LIMIT 1").bind(input.versionId).first<NcmecReport>();
    if (earlier) return earlier;
  }
  const upload = await uploadOf(env, input);
  const accountId = input.accountId ?? upload.accountId ?? (input.gameId ? await ownerAccountIdOf(env, input.gameId) : null);
  if (accountId) await pauseAccount(env, accountId, nowMs);

  const id = newId("ncmec_report");
  const files: KeptFile[] = [];
  for (const media of input.media) {
    const kept = await keepFile(env, keptKeyOf(env, id, files.length), media);
    if (kept) files.push(kept);
  }
  const details: ReportDetails = {
    incident_at_ms: upload.uploadedAtMs ?? nowMs,
    incident_url: input.incidentUrl,
    account: accountId ? await accountDetailsOf(env, accountId) : null,
    connection_address: upload.connectionAddress,
    uploaded_at_ms: upload.uploadedAtMs,
    intended_recipient_username: null,
    is_account_paused: accountId !== null,
    additional_info: `Matched by image matching (Arachnid Shield and Microsoft PhotoDNA) against lists of known child sexual abuse material, in ${input.where}. Nobody at Zaisma viewed the files.`,
    files,
  };
  const isBraked = await isPastDailyBrake(env, accountId, nowMs);
  await env.DB.prepare("INSERT INTO ncmec_reports (id, report_source, ncmec_report_status, account_id, game_id, version_id, details_json, created_at_ms) VALUES (?, 'image_match', ?, ?, ?, ?, ?, ?)")
    .bind(id, isBraked ? "stopped_by_brake" : "waiting", accountId, input.gameId, input.versionId, JSON.stringify(details), nowMs)
    .run();
  await audit(env.DB, input.gameId, "ncmec-report-made", `${id}: a known-image match in ${input.where}${isBraked ? ", stopped by the daily brake" : ""}`);
  if (isBraked) {
    await sendAlert(
      env,
      `URGENT: known abuse material in ${input.where}: not sent, the daily brake stopped it`,
      `Image matching found known child sexual abuse material in ${input.where}, and more than ${NCMEC_LIMITS.maximumMatchedAccountCountPerDay} accounts matched today, which is likelier a broken list than a wave, so it wasn't sent to NCMEC by itself. The account is paused and the files are kept. Don't open the pictures and don't delete anything. Send it, or decide it, at ${env.SITE_ORIGIN}/admin/ncmec.`,
    );
    return (await reportById(env, id))!;
  }
  const sent = await sendReport(env, id, deps, nowMs);
  await sendAlert(
    env,
    sent.ncmec_report_status === "sent"
      ? `URGENT: known abuse material in ${input.where}: reported to NCMEC, ${sent.ncmec_report_number}`
      : sent.ncmec_report_status === "failed"
        ? `URGENT: known abuse material in ${input.where}: report to NCMEC failed, file it by hand`
        : `URGENT: known abuse material in ${input.where}: report to NCMEC not sent yet`,
    `Image matching found known child sexual abuse material in ${input.where}. ${sentWords(sent)} The account behind it is paused until you clear it or ban it. Don't open the pictures and don't delete anything.\n\n${env.SITE_ORIGIN}/admin/ncmec`,
  );
  return sent;
}

/** What happened to a report, in a sentence for an alert. */
function sentWords(report: NcmecReport): string {
  if (report.ncmec_report_status === "sent") return `It was reported to NCMEC's CyberTipline by itself, report ${report.ncmec_report_number}.`;
  if (report.ncmec_report_status === "failed") return `It couldn't be reported (${report.last_error}): file it by hand at report.cybertip.org.`;
  return "NCMEC didn't answer, so it's tried again every 5 minutes; you'll hear if it still fails.";
}

/** Whether another account matching today goes past the brake. The same account matching again never does. */
async function isPastDailyBrake(env: Env, accountId: string | null, nowMs: number): Promise<boolean> {
  const dayStartMs = nowMs - (nowMs % DAY_MS);
  const row = await env.DB.prepare(
    "SELECT COUNT(DISTINCT account_id) AS account_count, MAX(CASE WHEN account_id = ? THEN 1 ELSE 0 END) AS has_this_account FROM ncmec_reports WHERE report_source = 'image_match' AND created_at_ms >= ? AND account_id IS NOT NULL",
  )
    .bind(accountId ?? "", dayStartMs)
    .first<{ account_count: number; has_this_account: number | null }>();
  if (row?.has_this_account) return false;
  return (row?.account_count ?? 0) >= NCMEC_LIMITS.maximumMatchedAccountCountPerDay;
}

/** The upload's connection address, time and account: given by the match site, or from the version's upload in the security log (kept 90 days). */
async function uploadOf(env: Env, input: MatchInput): Promise<{ accountId: string | null; connectionAddress: string | null; uploadedAtMs: number | null }> {
  if (input.connectionAddress !== undefined || !input.versionId) return { accountId: null, connectionAddress: input.connectionAddress ?? null, uploadedAtMs: input.uploadedAtMs ?? null };
  const event = await env.DB.prepare("SELECT account_id, connection_address, happened_at_ms FROM security_events WHERE version_id = ? AND kind = 'version_uploaded' ORDER BY happened_at_ms DESC LIMIT 1")
    .bind(input.versionId)
    .first<{ account_id: string; connection_address: string | null; happened_at_ms: number }>();
  return { accountId: event?.account_id ?? null, connectionAddress: event?.connection_address ?? null, uploadedAtMs: event?.happened_at_ms ?? input.uploadedAtMs ?? null };
}

async function ownerAccountIdOf(env: Env, gameId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT owners.account_id FROM games JOIN owners ON owners.id = games.owner_id WHERE games.id = ?").bind(gameId).first<{ account_id: string | null }>();
  return row?.account_id ?? null;
}

async function accountDetailsOf(env: Env, accountId: string): Promise<ReportDetails["account"]> {
  const account = await env.DB.prepare("SELECT id, username FROM accounts WHERE id = ?").bind(accountId).first<{ id: string; username: string }>();
  if (!account) return null;
  // An account's id is its Supabase user's id; Supabase may be off (a self-hosted copy) or down, and the report goes without.
  const email = realEmail((await authUserEmail(env, account.id).catch(() => null)) ?? "");
  return { account_id: account.id, username: account.username, email };
}

/** Copy one matched file into the reported files, streaming one the games bucket keeps so a big video never sits in memory. */
async function keepFile(env: Env, keptKey: string, media: MatchedMedia): Promise<KeptFile | null> {
  const { bucket } = keptBucket(env);
  let stored: R2Object | null = null;
  if (media.gamesKey) {
    const original = await env.GAMES.get(media.gamesKey);
    if (original) {
      const { readable, writable } = new FixedLengthStream(original.size);
      const [, put] = await Promise.all([original.body.pipeTo(writable), bucket.put(keptKey, readable, { httpMetadata: { contentType: media.contentType } })]);
      stored = put;
    }
  }
  if (!stored && media.bytes) stored = await bucket.put(keptKey, media.bytes, { httpMetadata: { contentType: media.contentType } });
  if (!stored) return null;
  return {
    kept_key: keptKey,
    original_path: media.path,
    content_type: media.contentType,
    size_bytes: stored.size,
    sha256: media.sha256 ?? (media.bytes ? await sha256Hex(media.bytes) : ""),
    match_message: media.matchMessage,
    is_publicly_available: media.isPubliclyAvailable,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hexOf(await crypto.subtle.digest("SHA-256", bytes));
}
const hexOf = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

// --- The pause ---------------------------------------------------------------------------------------

/** No uploads, publishing, posting, chat or friend requests until a person clears it or bans the account. */
export async function pauseAccount(env: Env, accountId: string, nowMs = Date.now()): Promise<void> {
  await env.DB.prepare("UPDATE accounts SET safety_paused_at_ms = COALESCE(safety_paused_at_ms, ?), chat_stopped_reason = COALESCE(chat_stopped_reason, 'in_review') WHERE id = ?").bind(nowMs, accountId).run();
}

/** A person cleared the account: its pause ends, and chat comes back unless a kept message still waits or chat was removed. */
export async function clearSafetyPause(env: Env, accountId: string, actor: string): Promise<boolean> {
  const cleared = await env.DB.prepare(
    `UPDATE accounts SET safety_paused_at_ms = NULL,
       chat_stopped_reason = CASE WHEN chat_stopped_reason = 'in_review' AND NOT EXISTS (SELECT 1 FROM chat_reviews WHERE sender_account_id = accounts.id AND chat_review_status IN ('pending', 'needs_person')) THEN NULL ELSE chat_stopped_reason END
     WHERE id = ? AND safety_paused_at_ms IS NOT NULL`,
  )
    .bind(accountId)
    .run();
  if (cleared.meta.changes) await audit(env.DB, null, "safety-pause-cleared", accountId, actor);
  return cleared.meta.changes > 0;
}

export async function pausedAccounts(env: Env): Promise<{ id: string; username: string; safety_paused_at_ms: number }[]> {
  return (await env.DB.prepare("SELECT id, username, safety_paused_at_ms FROM accounts WHERE safety_paused_at_ms IS NOT NULL ORDER BY safety_paused_at_ms").all<{ id: string; username: string; safety_paused_at_ms: number }>()).results;
}

// --- Cases a person confirmed -----------------------------------------------------------------------

/**
 * A chat review confirmed sexual toward a teen: kept ready for a person's press, with the message, the
 * messages before it, the sender and the teen's username. Answers the existing one when it's ready already.
 */
export async function readyChatReviewReport(env: Env, chatReviewId: string, nowMs = Date.now()): Promise<NcmecReport | null> {
  const earlier = await env.DB.prepare("SELECT * FROM ncmec_reports WHERE chat_review_id = ? LIMIT 1").bind(chatReviewId).first<NcmecReport>();
  if (earlier) return earlier;
  const review = await env.DB.prepare(
    "SELECT chat_reviews.*, games.slug AS game_slug FROM chat_reviews LEFT JOIN games ON games.id = chat_reviews.game_id WHERE chat_reviews.id = ?",
  )
    .bind(chatReviewId)
    .first<{ id: string; sender_account_id: string | null; game_id: string; text: string; recent_texts_json: string; created_at_ms: number; game_slug: string | null }>();
  if (!review) return null;
  const recent = JSON.parse(review.recent_texts_json) as string[];
  const details: ReportDetails = {
    incident_at_ms: review.created_at_ms,
    incident_url: review.game_slug ? `${env.SITE_ORIGIN}/g/${review.game_slug}` : null,
    account: review.sender_account_id ? await accountDetailsOf(env, review.sender_account_id) : null,
    connection_address: null,
    uploaded_at_ms: null,
    intended_recipient_username: null,
    is_account_paused: false,
    additional_info: `A chat message from an adult to a player aged 13 to 17, in a game's chat on Zaisma, stopped by Zaisma's chat filter and confirmed sexual toward a minor. The message: "${review.text}"${recent.length ? `. The sender's messages before it: ${recent.map((recentText) => `"${recentText}"`).join(", ")}` : ""}.`,
    files: [],
  };
  return insertReady(env, "chat_review", { accountId: review.sender_account_id, gameId: review.game_id, chatReviewId: review.id, reportGroupId: null }, details, nowMs);
}

/** A group of player reports a person confirmed at child safety: kept ready for a person's press, with what the reporters wrote and any picture. */
export async function readyPlayerReport(env: Env, reportGroupId: string, accountId: string, nowMs = Date.now()): Promise<NcmecReport | null> {
  const earlier = await env.DB.prepare("SELECT * FROM ncmec_reports WHERE report_group_id = ? LIMIT 1").bind(reportGroupId).first<NcmecReport>();
  if (earlier) return earlier;
  const { results: reports } = await env.DB.prepare(
    "SELECT reports.id, reports.game_id, reports.player_text, reports.player_reason, reports.has_picture, reports.reported_at_ms, games.slug FROM reports LEFT JOIN games ON games.id = reports.game_id WHERE reports.id = ? OR reports.report_group_id = ? ORDER BY reports.reported_at_ms",
  )
    .bind(reportGroupId, reportGroupId)
    .all<{ id: string; game_id: string; player_text: string; player_reason: string; has_picture: number; reported_at_ms: number; slug: string | null }>();
  if (!reports.length) return null;
  const id = newId("ncmec_report");
  const files: KeptFile[] = [];
  for (const report of reports.filter((row) => row.has_picture)) {
    const kept = await keepFile(env, keptKeyOf(env, id, files.length), { path: `picture with player report ${report.id}`, contentType: "image/jpeg", matchMessage: null, isPubliclyAvailable: false, gamesKey: `report-pictures/${report.id}.jpg` });
    if (kept) files.push(kept);
  }
  const details: ReportDetails = {
    incident_at_ms: reports[0]!.reported_at_ms,
    incident_url: reports[0]!.slug ? `${env.SITE_ORIGIN}/g/${reports[0]!.slug}` : null,
    account: await accountDetailsOf(env, accountId),
    connection_address: null,
    uploaded_at_ms: null,
    intended_recipient_username: null,
    is_account_paused: false,
    additional_info: `Players reported this account for child safety in a game on Zaisma, and a person at Zaisma confirmed it. What the reporters wrote: ${reports.map((report) => `"${report.player_text || report.player_reason}"`).join(", ")}.`,
    files,
  };
  return insertReady(env, "player_report", { accountId, gameId: reports[0]!.game_id, chatReviewId: null, reportGroupId }, details, nowMs, id);
}

async function insertReady(
  env: Env,
  source: ReportSource,
  subject: { accountId: string | null; gameId: string | null; chatReviewId: string | null; reportGroupId: string | null },
  details: ReportDetails,
  nowMs: number,
  id = newId("ncmec_report"),
): Promise<NcmecReport> {
  await env.DB.prepare("INSERT INTO ncmec_reports (id, report_source, ncmec_report_status, account_id, game_id, chat_review_id, report_group_id, details_json, created_at_ms) VALUES (?, ?, 'ready', ?, ?, ?, ?, ?, ?)")
    .bind(id, source, subject.accountId, subject.gameId, subject.chatReviewId, subject.reportGroupId, JSON.stringify(details), nowMs)
    .run();
  return (await reportById(env, id))!;
}

/**
 * A person's press: send a report that's ready, stopped by the brake or failed. Answers the report as it
 * stands after, or null when there's no such report or it's sent or being sent already.
 */
export async function sendByPerson(env: Env, id: string, actor: string, deps: NcmecDeps = defaultDeps(), nowMs = Date.now()): Promise<NcmecReport | null> {
  const opened = await env.DB.prepare("UPDATE ncmec_reports SET ncmec_report_status = 'waiting', send_attempt_count = 0, last_error = NULL WHERE id = ? AND ncmec_report_status IN ('ready', 'stopped_by_brake', 'failed')").bind(id).run();
  if (!opened.meta.changes) return null;
  const report = (await reportById(env, id))!;
  await audit(env.DB, report.game_id, "ncmec-report-pressed", id, actor);
  return sendReport(env, id, deps, nowMs);
}

// --- Sending -----------------------------------------------------------------------------------------

/** Every 5 minutes: try again the reports NCMEC didn't take yet. */
export async function sendWaitingReports(env: Env, deps: NcmecDeps = defaultDeps(), nowMs = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id FROM ncmec_reports WHERE ncmec_report_status = 'waiting' ORDER BY created_at_ms LIMIT 20").all<{ id: string }>();
  for (const { id } of results) await sendReport(env, id, deps, nowMs);
  return results.length;
}

/**
 * One try at sending a waiting report: open it, upload and describe each file, finish it. A failed try leaves
 * it waiting for the next run; past NCMEC_LIMITS.maximumSendAttemptCount, or with no keys, it's failed and
 * Julius is told to file it by hand. The keys never reach a log, an error or the database.
 */
export async function sendReport(env: Env, id: string, deps: NcmecDeps = defaultDeps(), nowMs = Date.now()): Promise<NcmecReport> {
  const report = (await reportById(env, id))!;
  if (report.ncmec_report_status !== "waiting") return report;
  if (!env.NCMEC_USERNAME || !env.NCMEC_PASSWORD) {
    await env.DB.prepare("UPDATE ncmec_reports SET ncmec_report_status = 'failed', last_error = ? WHERE id = ?").bind("NCMEC_USERNAME and NCMEC_PASSWORD aren't set", id).run();
    return (await reportById(env, id))!;
  }
  // Claim the try, so two overlapping runs never send the same report.
  const claim = await env.DB.prepare("UPDATE ncmec_reports SET send_attempt_count = send_attempt_count + 1 WHERE id = ? AND send_attempt_count = ? AND ncmec_report_status = 'waiting'").bind(id, report.send_attempt_count).run();
  if (!claim.meta.changes) return (await reportById(env, id))!;
  const client = ncmecClient(env, deps);
  try {
    // A try that stopped halfway left a report open at NCMEC: take it back first, so it's sent once.
    if (report.ncmec_report_number) await client.form("/retract", report.ncmec_report_number).catch(() => undefined);
    const details = detailsOf(report);
    const reportNumber = tagText(await client.xml("/submit", reportXml(report.report_source, details)), "reportId");
    if (!reportNumber) throw new Error("NCMEC answered /submit with no reportId");
    await env.DB.prepare("UPDATE ncmec_reports SET ncmec_report_number = ? WHERE id = ?").bind(reportNumber, id).run();
    const { bucket } = keptBucket(env);
    for (const file of details.files) {
      const kept = await bucket.get(file.kept_key);
      if (!kept) throw new Error(`The kept file ${file.kept_key} is missing`);
      const fileId = tagText(await client.upload(reportNumber, fileNameOf(file.original_path), file.content_type, kept), "fileId");
      if (!fileId) throw new Error("NCMEC answered /upload with no fileId");
      await client.xml("/fileinfo", fileDetailsXml(reportNumber, fileId, file, details));
    }
    await client.form("/finish", reportNumber);
    await env.DB.prepare("UPDATE ncmec_reports SET ncmec_report_status = 'sent', sent_at_ms = ?, erase_at_ms = ?, last_error = NULL WHERE id = ?").bind(nowMs, nowMs + NCMEC_LIMITS.keptDurationDays * DAY_MS, id).run();
    if (report.chat_review_id) await env.DB.prepare("UPDATE chat_reviews SET reported_at_ms = COALESCE(reported_at_ms, ?) WHERE id = ?").bind(nowMs, report.chat_review_id).run();
    await audit(env.DB, report.game_id, "ncmec-report-sent", `${id}: NCMEC report ${reportNumber}`);
  } catch (error) {
    const why = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    const isLastTry = report.send_attempt_count + 1 >= NCMEC_LIMITS.maximumSendAttemptCount;
    await env.DB.prepare("UPDATE ncmec_reports SET ncmec_report_status = ?, last_error = ? WHERE id = ?").bind(isLastTry ? "failed" : "waiting", why, id).run();
    if (isLastTry) {
      await sendAlert(env, "URGENT: a report to NCMEC failed: file it by hand", `A report to NCMEC's CyberTipline failed after ${NCMEC_LIMITS.maximumSendAttemptCount} tries (${why}). Press Send again, or file it by hand at report.cybertip.org: ${env.SITE_ORIGIN}/admin/ncmec`);
    }
  }
  return (await reportById(env, id))!;
}

/** Once a day: a report sent a year ago is erased, with its kept files. */
export async function eraseOldReports(env: Env, nowMs = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare("SELECT * FROM ncmec_reports WHERE erase_at_ms IS NOT NULL AND erase_at_ms <= ? LIMIT 100").bind(nowMs).all<NcmecReport>();
  const { bucket } = keptBucket(env);
  for (const report of results) {
    const keys = detailsOf(report).files.map((file) => file.kept_key);
    if (keys.length) await bucket.delete(keys);
    await env.DB.prepare("DELETE FROM ncmec_reports WHERE id = ?").bind(report.id).run();
  }
  return results.length;
}

// --- NCMEC's API -------------------------------------------------------------------------------------

function ncmecClient(env: Env, deps: NcmecDeps) {
  const baseUrl = (env.NCMEC_API_URL || NCMEC_API_URL).replace(/\/$/, "");
  const authorization = `Basic ${btoa(`${env.NCMEC_USERNAME}:${env.NCMEC_PASSWORD}`)}`;
  const answer = async (path: string, response: Response): Promise<string> => {
    const text = await response.text();
    const code = tagText(text, "responseCode");
    if (!response.ok || code !== "0") throw new Error(`NCMEC answered ${path} with ${response.status}${code ? `, code ${code}` : ""}${tagText(text, "responseDescription") ? `: ${tagText(text, "responseDescription")!.slice(0, 120)}` : ""}`);
    return text;
  };
  return {
    async xml(path: string, body: string): Promise<string> {
      return answer(path, await deps.fetch(`${baseUrl}${path}`, { method: "POST", headers: { authorization, "content-type": "text/xml; charset=utf-8" }, body }));
    },
    async form(path: string, reportNumber: string): Promise<string> {
      return answer(path, await deps.fetch(`${baseUrl}${path}`, { method: "POST", headers: { authorization, "content-type": "application/x-www-form-urlencoded" }, body: `id=${encodeURIComponent(reportNumber)}` }));
    },
    /** A multipart upload streamed from the kept file, with a known length, so a big video never sits in memory. */
    async upload(reportNumber: string, fileName: string, contentType: string, kept: R2ObjectBody): Promise<string> {
      const boundary = `zaisma${crypto.randomUUID().replace(/-/g, "")}`;
      const encoder = new TextEncoder();
      const head = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="id"\r\n\r\n${reportNumber}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`);
      const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
      const { readable, writable } = new FixedLengthStream(head.byteLength + kept.size + tail.byteLength);
      const writing = (async () => {
        const writer = writable.getWriter();
        await writer.write(head);
        const reader = kept.body.getReader();
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) await writer.write(chunk.value);
        await writer.write(tail);
        await writer.close();
      })();
      const [response] = await Promise.all([deps.fetch(`${baseUrl}/upload`, { method: "POST", headers: { authorization, "content-type": `multipart/form-data; boundary=${boundary}` }, body: readable }), writing]);
      return answer("/upload", response);
    },
  };
}

const tagText = (xmlText: string, tag: string): string | null => xmlText.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim() ?? null;

/** A file's name for NCMEC: its last part, in plain letters. */
const fileNameOf = (path: string) => (path.split("/").pop() || "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "file";

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);

/** An element with its text escaped, or nothing when there's no text. */
const element = (tag: string, text: string | null | undefined) => (text === null || text === undefined || text === "" ? "" : `<${tag}>${escapeXml(text)}</${tag}>`);
/** An element around other elements, or nothing when they're all empty. */
const group = (tag: string, ...children: string[]) => (children.join("") ? `<${tag}>${children.join("")}</${tag}>` : "");

const isoTime = (atMs: number) => iso(atMs)!;

const ipCaptureEvent = (details: ReportDetails) =>
  details.connection_address ? group("ipCaptureEvent", element("ipAddress", details.connection_address), element("eventName", "Upload"), details.uploaded_at_ms ? element("dateTime", isoTime(details.uploaded_at_ms)) : "") : "";

/** The report itself, in the order NCMEC's schema keeps (report.cybertip.org/ispws/xsd). */
export function reportXml(source: ReportSource, details: ReportDetails): string {
  const account = details.account;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<report xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://report.cybertip.org/ispws/xsd">` +
    group("incidentSummary", element("incidentType", INCIDENT_TYPES[source]), element("incidentDateTime", isoTime(details.incident_at_ms))) +
    (details.incident_url ? group("internetDetails", group("webPageIncident", element("url", details.incident_url))) : "") +
    group("reporter", group("reportingPerson", element("firstName", "Zaisma"), element("lastName", "Safety"), element("email", "safety@zaisma.com"))) +
    (account
      ? group(
          "personOrUserReported",
          account.email ? group("personOrUserReportedPerson", element("email", account.email)) : "",
          element("espIdentifier", account.account_id),
          element("espService", "Zaisma"),
          element("screenName", account.username),
          ipCaptureEvent(details),
          details.is_account_paused ? element("accountTemporarilyDisabled", "true") : "",
        )
      : "") +
    (details.intended_recipient_username ? group("intendedRecipient", element("espService", "Zaisma"), element("screenName", details.intended_recipient_username)) : "") +
    element("additionalInfo", details.additional_info) +
    `</report>`
  );
}

/** One file's details: nobody at Zaisma viewed it, and whether anyone could reach it. */
export function fileDetailsXml(reportNumber: string, fileId: string, file: KeptFile, details: ReportDetails): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<fileDetails xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://report.cybertip.org/ispws/xsd">` +
    element("reportId", reportNumber) +
    element("fileId", fileId) +
    element("originalFileName", file.original_path.slice(0, 256)) +
    (details.uploaded_at_ms ? element("uploadedToEspTimestamp", isoTime(details.uploaded_at_ms)) : "") +
    element("fileViewedByEsp", "false") +
    element("exifViewedByEsp", "false") +
    element("publiclyAvailable", file.is_publicly_available ? "true" : "false") +
    (file.sha256 ? `<originalFileHash hashType="SHA256">${file.sha256}</originalFileHash>` : "") +
    ipCaptureEvent(details) +
    element("additionalInfo", file.match_message) +
    `</fileDetails>`
  );
}
